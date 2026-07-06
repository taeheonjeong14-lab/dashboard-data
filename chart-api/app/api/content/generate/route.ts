import { NextRequest, NextResponse } from 'next/server';
import { chartAppAuthMiddleware } from '@/lib/chart-app/auth';
import { geminiGenerateText, tryParseJsonObject } from '@/lib/chart-app/gemini';
import {
  getGeneratedByType,
  getHealthCheckupGeneratedContentForRun,
  upsertGeneratedRunContent,
} from '@/lib/chart-app/generated-content';
import {
  generateHealthCheckupContent,
  generateHealthCheckupSection,
  isRegenerateSection,
  HEALTH_CHECKUP_COVER_STORAGE_KEYS,
  parseHealthCheckupPayloadFromStorage,
  type HealthCheckupGeneratedContent,
} from '@/lib/chart-app/health-checkup-content-llm';
import { validateHealthCheckupGeneratedContent } from '@/lib/chart-app/health-checkup-content-schema';
import {
  applyImagePlacementForSection,
  runImagePlacementForRun,
} from '@/lib/chart-app/health-report-image-placement-run';
import { isParseRunUuid } from '@/lib/chart-app/uuid';
import { ensureHealthCheckupReviewShareLink } from '@/lib/chart-app/review-share-link';
import { getReportPublicBase } from '@/lib/chart-app/report-public-base';
import { getChartPgPool } from '@/lib/db';
import { hospitalHasTokens, chargeOperationTokens } from '@/lib/billing/token-charge';
import { applyHealthCheckupCoverFromSource } from '@/lib/chart-app/health-checkup-cover-from-source';
import { loadReportSourceData } from '@/lib/chart-app/report-source';

const HEALTH_CHECKUP = 'health_checkup';
const BLOG_POST = 'blog_post';
const BLOG_CAUSAL = 'blog_causal';
const BLOG_CAUSAL_PHASE = 'blog_causal_phase'; // 1단계 중 특정 날짜(phase)만 다시 생성
const BLOG_DETAIL = 'blog_detail';
const BLOG_OUTLINE = 'blog_outline';

// 진료케이스 케이스 개요(hospital-ui blog_case) 라벨
const OVERVIEW_LABELS: { key: string; label: string }[] = [
  { key: 'main_disease', label: '주질환명' },
  { key: 'comorbidities', label: '동반 질환명' },
  { key: 'visit_background', label: '내원 배경' },
  { key: 'patient_notes', label: '환자 특이사항' },
  { key: 'diagnosis_method', label: '진단 방식' },
  { key: 'treatment_process', label: '치료 과정' },
  { key: 'aftercare_plan', label: '사후 관리 계획' },
  { key: 'emphasis', label: '강조 희망 사항' },
];

// ── 진료케이스 블로그 3단계 systemInstruction (docs/case-blog 기준) ──────────
const SYS_CAUSAL = `당신은 동물병원을 운영하는 수의사이자 병원 원장입니다.
지금은 진료 사례 블로그 글 작성의 [1단계 — 날짜별 인과 흐름 재구성]입니다.
차트의 모든 방문 날짜를 시간순으로 하나도 빠짐없이 나열하고, 각 날짜에 무슨 일이 왜 있었는지 임상 인과를 복원합니다.

# 문체 — 최대한 간단명료
- 군더더기·미사여구·중복 없이 핵심만. 불릿 하나 = 한 줄 = 한 사실/이유.

# 반드시 지킬 것
- 제공된 입력(CHART_SOURCE, CASE_OVERVIEW)에 있는 내용만 사용한다.
  (처치를 잇는 "왜"의 일반 임상 원리 설명은 예외로 허용. 환자 고유 사실—
   증상·수치·결과—은 입력에 있을 때만 쓴다.)
- "고려됨"으로만 적힌 검사·처치는 시행한 것으로 쓰지 않는다.
- 약은 제품명(약 이름)·정확한 용량·용법을 쓰지 않는다. 꼭 필요하면 성분명·약효 분류("항생제" 등)까지만.
- 약어는 약어사전으로 해석하고, 모르는 약어는 추측 말고 생략한다.
- 반드시 한국어로 작성한다. (코드/JSON 키는 영어 유지)

# 다룰 범위 — 주질환명 중심 (매우 중요)
- CASE_OVERVIEW의 "주질환명"이 이 케이스의 핵심 주제다(1개). 인과 흐름은 그 질환의 진단·치료 과정만 축으로 삼는다.
- "동반 질환명"은 주질환의 진단·치료 과정에 직/간접적으로 관련된 질환이다. 주질환 흐름에 영향을 주는 선에서만 함께 다루고, 독립된 별도 스토리로 분리하지 않는다.
  · 예: 마취·수술 안전성에 영향을 주는 기저질환, 주질환 치료를 위해 먼저/함께 처치해야 하거나 진단·치료 방향을 바꾸는 동반질환·합병증.
- 차트(CHART_SOURCE)에는 주질환·동반질환과 무관한 다른 질환·소견이 함께 적혀 있을 수 있다. 차트에 있다는 이유로 그것들을 흐름·스토리에 끌어오지 말 것(기본은 제외).
- 동반 질환을 포함하는 경우에도 "주질환 치료 과정에서 왜 고려/처치했는지"로 연결해 흐름 안에 녹인다.
- CASE_OVERVIEW의 강조 희망사항(emphasis)이 있으면 그 강조점에 맞춰 흐름의 중심을 잡는다(같은 차트라도 강조점에 따라 중심이 달라진다).

# 날짜별 나열 규칙 (핵심)
1. 차트에 기록된 **모든 방문 날짜를 시간순으로 각각 하나의 phase**로 만든다. 여러 날짜를 한 phase로 묶지 말 것(병합 금지), 어떤 날짜도 빠뜨리지 말 것.
2. 특별한 기록이 없는 날짜도 phase는 만들되 actions 와 nextStep 을 빈 배열([])로 둔다. 억지로 채우지 않는다.
3. 주질환과 무관한 방문만 있는 날짜는 action.what 에 그날 한 것만 간단히 적고, why/result·nextStep 엔 억지로 엮지 않는다.
4. 한 날짜 안에 처치가 여럿이면 앞 처치가 다음을 부른 이유로 엮고, 다음 날짜로는 "왜 이어졌는지"로 잇는다. 이 "왜"는 차트에 없어도 일반 임상 원리로 채운다.
5. 반복 복사된 항목(사료/유치교체 등)은 변화 없으면 제외한다.

# 경과 시점(period) 규칙 — 중요
- "최초 진단일" = 이 케이스에서 다루는 질병을 병원에서 "처음 진단받은 날".
- period 는 항상 아래 형식으로만 쓴다:
  "0000년 00월 00일 (최초 진단일로부터 약 00일 후)"  또는  "0000년 00월 00일 (최초 진단일로부터 약 00주 후)"
  · 날짜는 차트에 기록된 "정확한 날짜"만 사용한다(추측 금지).
  · 괄호 안 경과는 최초 진단일 기준 차이. 약 30일 이내면 "약 N일 후", 그 이상이면 "약 N주 후"(또는 "약 N개월 후").
  · 최초 진단일에 해당하는 단계는 "0000년 00월 00일 (최초 진단일)" 로 적는다.
- "2월 초", "약 한 달 후", "초진 시점" 같은 두루뭉술하거나 날짜 없는 표현 금지.
- 한 단계가 여러 날짜에 걸치면 그 단계의 시작일을 기준으로 위 형식으로 적는다.
- 차트에 날짜가 없으면 임의 날짜를 지어내지 말 것.
- 날짜-사실 정합성(매우 중요, 신뢰도 직결): 각 액션의 what/why/result 및 nextStep 에 넣는 검사·수치·소견·처치는
  그 단계의 period(날짜)에 자료상 실제로 기록된 것만 넣는다. 다른 날짜에 한 검사·수치를 이 단계로 끌어오지 말 것.
  · 어느 날짜에 한 것인지 자료(날짜별 차트/검사 기록)로 확정할 수 없는 항목은 특정 단계(날짜)에 임의로 귀속시키지 않는다.

# 각 행위(action)의 성격(types)·마취
- **성격 태그는 날짜(phase)가 아니라 개별 행위(action)에 붙인다.** 각 action 에 types 배열을 넣는다(보통 1개, 여러 성격이면 여러 개 가능). 아래 기준을 정확히 따른다:
  · exam_dx = 검사 및 진단 : 어떤 질환인지 "진단"하기 위한 검사 행위. (수술 후 결과·회복을 확인하는 재검사는 여기가 아니라 postop_followup)
  · preop = 술 전 검사 : 수술이 포함된 케이스에서, (최종 진단명과 무관할 수 있어도) 마취가 가능한지 판단하기 위한 검사 행위.
  · surgical = 외과 치료 : 수술 행위(수술 그 자체).
  · postop_recovery = 술 후 회복 : 수술 이후 회복을 위한 처치(통증·염증 관리, 상처·봉합 관리, 회복기 투약·수액 등).
    수술로 생긴 상태를 낫게 하는 "회복 처치"이며, 별개의 내과 질환을 치료하는 것이 아니다.
  · postop_followup = 술 후 경과확인 : 수술이 잘 됐는지·회복이 잘 되고 있는지 확인하기 위한 재검사(수술 후 재촬영 X-ray·재혈액검사·재초음파, 봉합/상처 경과 확인 등).
    같은 검사라도 "새 질환 진단(exam_dx)"이 아니라 "수술 결과·회복 경과 확인"이 목적이면 exam_dx 가 아니라 postop_followup 로 붙인다.
  · medical = 내과 치료 : **수술 대상이 아닌 내과 질환 그 자체를 약물로 치료**하는 행위.
    수술 후 회복을 위한 투약은 medical 이 아니라 postop_recovery 로 분류한다(내과 치료로 간주하지 말 것).
  · admission = 입원 치료 : 입원 조치·입원 관리 행위.
  · discharge = 퇴원 : 퇴원 조치 행위.
  · aftercare = 사후관리 안내 : 병원이 보호자에게 앞으로의 재발 방지·건강관리·홈케어를 위해 "이렇게 해주세요"라고 안내한 내용(예: 식이·체중 관리, 재검 주기, 생활 주의사항, 홈케어 방법 등).
    **차트에 이런 보호자 대상 안내가 있으면, 그 안내 내용을 하나의 action(what=안내한 내용)으로 만들어 이 태그를 붙인다.** (안내가 없으면 억지로 만들지 않는다.)
  · other = 기타 : 위 어디에도 명확히 들어맞지 않거나 성격 판단이 애매한 행위. 억지로 다른 태그를 붙이지 말고 other 로 둔다.
  ※ surgical(외과)와 medical(내과)는 **한 행위에 동시에 넣지 않는다. 둘 중 더 적합한 하나만** 고른다.
    수술 행위는 surgical 로 표기하고, 수술 후 회복·투약 행위는 medical 이 아니라 postop_recovery 로 표기한다.
    medical 은 수술과 무관한 내과 질환을 약물로 치료하는 행위에만 쓴다.
  예: 복부 초음파로 진단 → ["exam_dx"]. 마취 전 혈액검사 → ["preop"]. 종양 절제 수술 → ["surgical"]. 수술 부위 소독·회복기 투약 → ["postop_recovery"]. 수술 2주 뒤 재촬영으로 회복 확인 → ["postop_followup"]. 만성 신장질환 약물 처방 → ["medical"]. "재발 방지 위해 저지방 식이·체중 관리하세요" 안내 → ["aftercare"].
- **행위(action)가 있으면 types 에 반드시 성격을 최소 1개 붙인다. 위 어디에도 맞지 않으면 ["other"] 로 붙인다. types 를 빈 배열([])로 두지 않는다.**
  (types 가 [] 인 경우는 애초에 action 이 하나도 없는 빈 날짜뿐이다.)
- 전신마취를 동반한 행위가 하나라도 있으면 anesthesia=true.
- (수술형·내과형·복합형의 세부 전개는 2단계에서 다루므로 여기선 판단만 한다.)

# 검사·처치의 순서 — 중요
- 진단 과정에서는 검사가 "어떤 순서로" 진행됐는지가 핵심이다. actions 를 시행 순서대로 배열해 사슬처럼 잇는다:
  "무엇을 확인하려고(why) → 어떤 검사를 했고(what) → 결과가 어떻게 나왔는지(result)". 그 결과로 다음에 무엇을 하기로 했는지는 nextStep 에 적는다.
  · 예: "OO 의심 → A검사 → (결과) → 그래서 B검사 → (결과) → 수술 결정 → 술 전 검사 → (결과)".
- 치료(수술 등) 과정의 세부 처치를 나열할 때도 순서가 중요하다. 표준 수의 시술 순서에 맞게 배열한다.
  · 예(치과 스케일링·발치): 마취 → 스케일링 → 치아 방사선 촬영 → 발치 순. (자료상 순서가 불명확하면 표준 시술 순서로)
- 자료만으로 정확한 순서를 알기 어려우면, 아는 검사·처치를 "의학적으로 가장 말이 되는 순서"로 배열한다.
  · 단, 안 한 검사·처치를 지어내는 것은 절대 금지(존재하는 것들의 순서만 합리적으로 정렬).
- 순서 원칙: 질병을 진단·확정하는 검사가 먼저 오고, 그 결과로 치료(수술 등)를 결정한 뒤에 '술 전 검사'(마취 안전성 평가)가 온다.
  술 전 검사가 질환 진단 검사보다 앞서지 않게 한다.

# 의학적 근거 — 권위 있는 출처 (중요)
- 검사·처치의 순서나 이유처럼 차트에 없어 일반 임상 원리로 채우는 부분은, 한국·미국의 권위 있는 수의학
  지식(수의 교과서·동료심사 논문·공인 수의 기관/대학 자료)에 부합하게 쓴다.
- 출처가 불분명한 통념이나 부정확한 정보로 채우지 말 것. 확실치 않으면 보편적으로 인정되는 수준에서만 서술한다.
- 이 원칙은 일반 원리 보강에만 적용되며, 환자 고유 사실(증상·수치·결과)은 여전히 입력 자료에 있을 때만 쓴다.

# 액션(무엇/왜/결과)과 Next step 구분 — 중요
- 각 날짜(phase)는 그날 시행한 "행위"들을 actions 배열로 담는다. 행위 하나 = action 하나 = { what, why, result, types, detail }.
  · what (무엇을 했나): 그 단계에서 시행한 검사·처치·행위 "자체"만. (예: "복부 초음파 시행", "혈액검사 시행", "항생제 처방", "중성화 수술 시행") ※ 결과·수치는 여기 넣지 말 것.
  · why (왜 했나): 그 검사/처치를 한 임상적 이유·원리. 한 줄. (없으면 "")
  · result (결과): 그 행위로 나온 결과 — 검사 수치·진단·처방 후 변화·경과 등 차트에 있는 사실. 한 줄. (없으면 "")
  · types (성격): 위 "# 각 행위(action)의 성격" 기준으로 이 행위의 성격 태그 배열. **반드시 1개 이상**, 맞는 게 없으면 ["other"](빈 배열 금지).
  · detail (상세 내용): 아래 "# 상세 내용(detail)" 규칙 참고. surgical·medical 행위에만 채우고, 그 외 행위는 "" 로 둔다.
- nextStep (다음 단계): 그날 결과들을 종합해 "다음에 무엇을 하기로 결정했는지". 짧은 불릿 배열.
  · **가장 마지막 phase(마지막 방문 날짜)는 이후 단계가 없으므로 nextStep 을 반드시 [] 로 둔다.** 그 외에도 다음 단계가 없으면 [].

# 상세 내용(detail) — surgical·medical 행위에만
- types 에 surgical 이 있는 행위: 그 수술이 어떤 절차로 진행됐는지 **시간 순서대로** 간단명료하게 한 줄로 정리한다(예: "전신마취 → 절개 → 병변 절제 → 세척 → 봉합"). 미사여구·긴 문단 금지.
  · 이 detail 에 한해, 차트에 절차 세부가 없어도 **표준 수의 시술 순서(권위 있는 수의학 지식)로 보강**해 자연스럽게 나열하는 것을 허용한다. 단 실제로 하지 않은 처치를 지어내지 말고, 환자 고유 사실(수치·소견)은 여전히 자료에 있을 때만.
- types 에 medical 이 있는 행위: 어떤 종류의 약을 처방했는지 적는다. **성분명·약효 분류("항생제","소염진통제" 등)까지만**, 제품명·정확한 용량·용법은 쓰지 않는다.
- surgical·medical 이 아닌 행위는 detail 을 "" 로 둔다.

# 서술 형식
- action 의 what·why·result 는 각각 한 줄로 간단명료하게(한 가지 사실/이유만, 긴 문단 금지). actions 는 시행 순서대로 배열한다.
- 한 날짜에 행위가 여럿이면 action 여러 개로 나눈다(무엇을 했나 하나당 action 하나).
- nextStep 은 1~2개의 짧은 불릿.

# 출력 형식 — JSON only (다른 텍스트·마크다운 코드펜스 없이 JSON만)
{
  "axis": "이 케이스 흐름의 축 한 줄 요약",
  "anesthesia": true 또는 false,
  "phases": [
    {
      "id": "phase_1",
      "name": "그 날짜 요약 이름(짧게)",
      "period": "0000년 00월 00일 (최초 진단일로부터 약 00일/00주 후) — 예: 2026년 02월 17일 (최초 진단일로부터 약 2주 후)",
      "actions": [
        {
          "what": "그날 한 검사/처치/행위 자체 (한 줄, 결과·수치 제외)",
          "why": "그것을 한 임상적 이유 (한 줄, 없으면 빈 문자열)",
          "result": "그 행위로 나온 결과·수치·소견 (한 줄, 없으면 빈 문자열)",
          "types": ["exam_dx | preop | surgical | postop_recovery | postop_followup | medical | admission | discharge | aftercare | other 중 이 행위의 성격(반드시 1개 이상, 맞는 게 없으면 [\"other\"], 빈 배열 금지)"],
          "detail": "surgical=수술 절차 시간순 한 줄 / medical=처방 약 종류(성분·약효 분류) / 그 외=빈 문자열"
        }
      ],
      "nextStep": ["그 결과로 다음에 하기로 한 것 — 불릿 (없으면 [])"]
    }
  ]
}
(차트의 모든 방문 날짜를 빠짐없이 시간순으로. 특별한 기록이 없는 날짜도 phase 는 만들되 actions 와 nextStep 은 [] 로 둔다.)

# 약어사전
CC=주호소, Rx=처방, CE=진료/코멘트, OU=양쪽 눈, AD=오른쪽 귀,
bid=하루2회, sid=하루1회, tid=하루3회, cast Sx=중성화수술,
aus NRF=청진 특이소견 없음, no vdsc=구토/설사/기침 등 없음`;

// ── 1단계 중 특정 날짜(phase)만 다시 생성 ──────────────────────────────────
const SYS_CAUSAL_PHASE = `당신은 동물병원을 운영하는 수의사이자 병원 원장입니다.
진료 사례 블로그 [1단계 — 날짜별 인과 흐름]에서 **하나의 날짜(phase) 하나만** 다시 작성합니다.

# 입력
- FULL_FLOW: 전체 인과 흐름(JSON). 앞뒤 맥락 파악용(다른 날짜는 절대 수정/출력하지 않는다).
- TARGET_PHASE: 다시 작성할 대상 날짜(JSON) 하나.
- FEEDBACK: admin 이 지적한 수정 요청. 이 요청을 최우선으로 반영한다. (비어 있으면 품질을 높여 더 정확·간결하게 다시 정리)
- CHART_SOURCE / CASE_OVERVIEW: 근거 자료.

# 규칙 (1단계와 동일)
- 그 날짜 하나만 다룬다. period(날짜)는 FEEDBACK 에 날짜 수정 요청이 없으면 그대로 유지한다.
- 없는 사실 창작 금지. 환자 고유 사실(검사·수치·소견·처치)은 CHART_SOURCE/자료에서 그 날짜에 실제 기록된 것만.
- 검사·처치의 순서나 이유처럼 자료에 없어 채우는 부분은 권위 있는 수의학 원리에 맞게.
- 구조:
  · actions: 행위별 { what(무엇을 했나·한 줄), why(왜·한 줄, 없으면 ""), result(결과·수치·소견 한 줄, 없으면 ""), types(이 행위의 성격 배열), detail(상세 내용) }. 시행 순서대로.
  · detail: surgical 행위면 수술 절차를 시간 순서대로 간단명료하게 한 줄(표준 수의 시술 순서 보강 허용, 없는 처치 창작 금지). medical 행위면 처방한 약의 종류(성분·약효 분류까지, 제품명·용량 금지). 그 외 행위는 "".
  · 성격 태그(types)는 **날짜가 아니라 각 행위(action)에** 붙인다 — exam_dx(검사 및 진단: 새 질환을 진단하는 검사)/preop(술 전 검사: 수술 케이스에서 마취 가능 판단 검사)/surgical(외과: 수술 행위)/postop_recovery(술 후 회복: 수술 이후 회복·상처관리·회복기 투약)/postop_followup(술 후 경과확인: 수술 결과·회복 확인을 위한 재검사·재촬영)/medical(내과: 수술과 무관한 내과 질환 자체를 약물로 치료)/admission(입원 치료)/discharge(퇴원)/aftercare(사후관리 안내: 보호자에게 준 재발 방지·건강관리·홈케어 안내 → 그 내용을 action 으로 만들어 붙임)/other(기타: 애매하면) 중 해당하는 것(**행위가 있으면 반드시 1개 이상**, 맞는 게 없으면 ["other"], 빈 배열 금지). ※ surgical 와 medical 는 한 행위에 동시에 넣지 말고 더 적합한 하나만(수술 행위는 surgical). 수술 후 회복·투약 행위는 medical 이 아니라 postop_recovery. 수술 후 결과·회복을 확인하는 재검사는 exam_dx 가 아니라 postop_followup.
  · nextStep: 그 결과로 다음에 하기로 한 것(짧은 불릿 배열, 없으면 []).

# 출력 형식 — JSON only (코드펜스·다른 텍스트 없이, 딱 phase 객체 하나)
{
  "id": "TARGET_PHASE 의 id 를 그대로 유지",
  "name": "그 날짜 요약 이름(짧게)",
  "period": "TARGET_PHASE 의 period (요청에 날짜 수정 없으면 그대로)",
  "actions": [ { "what": "...", "why": "...", "result": "...", "types": ["exam_dx | preop | surgical | postop_recovery | postop_followup | medical | admission | discharge | aftercare | other"], "detail": "surgical=수술 절차 시간순 / medical=처방 약 종류 / 그 외=빈 문자열" } ],
  "nextStep": ["..."]
}`;

// ── 진료케이스 2단계 — 진단·치료 세부 흐름 systemInstruction ──────────────
const SYS_DETAIL = `당신은 동물병원을 운영하는 수의사이자 병원 원장입니다.
지금은 진료 사례 블로그 글 작성의 [2단계 — 진단·치료 과정 세부 흐름]입니다.
1단계 인과 흐름(CAUSAL_FLOW) 전체에서 '진단 과정'과 '치료 과정' 두 갈래만 떼어내,
각각을 보호자가 읽었을 때 병원의 전문성이 드러나도록 "표준 임상 순서의 세부 단계"로 전개합니다.

# 문체 — 최대한 간단명료
- 각 step의 why·what·detail·result 는 핵심만 한두 문장으로. 군더더기·미사여구·중복 금지.

# 이 단계의 특별 허용 — 표준 수의학 지식 사용 (다른 단계와 다름, 매우 중요)
- 차트(CHART_SOURCE)에 **실제로 시행됐다고 기록된 검사·처치**를 큰 틀로 가져온다.
- 그 각각을 "어떻게/어떤 순서로 진행되는지" 디테일하게 설명하기 위해, **표준 수의학 지식으로 세부 단계를 보강**하는 것을 이 단계에 한해 허용한다.
  · 예) 차트에 "스케일링·발치" → 치료 세부 = 전신마취 → 스케일링 → 치아 방사선 촬영 → 발치 (각 단계의 목적·방법).
- ★표준 지식의 출처 제한: **미국 또는 한국의 수의학 교과서·동료심사(peer-reviewed) 연구·공인 수의 기관/대학 자료**에 부합하는 내용만 사용한다.
  다른 나라 자료·출처 불명의 통념·불확실한 정보로 채우지 말 것.

# 그래도 절대 지킬 것 (창작 금지의 경계)
- 차트에 **없는 검사·처치 자체를 새로 만들지 말 것.** 보강은 "실제로 한 처치를 시행하기 위해 표준적으로 수반되는 세부 단계"까지만이다.
  · 예) "발치"를 했다면 그에 수반되는 마취·국소처치는 전개 가능. 하지만 차트에 없는 별개 처치(스케일링 기록이 없는데 스케일링 추가 등)는 넣지 말 것.
- 약은 제품명·정확한 용량·용법 금지(성분명·약효 분류까지만). 특정 장비 모델명·도구 규격 금지(일반 시술명·모달리티까지만).
- 환자 고유 사실(증상·수치·결과)은 CHART_SOURCE/CASE_OVERVIEW에 있을 때만 쓴다(보강 대상은 '방법·순서'이지 '환자 결과'가 아니다).
- 약어는 약어사전으로 해석하고, 모르는 약어는 추측 말고 생략. 한국어로 작성(JSON 키는 영어).

# 다룰 범위
- CASE_OVERVIEW의 '주질환명' 진단·치료만 축으로 삼는다(1단계와 동일 기준). '동반 질환명'은 주질환 진단·치료에 관련된 선에서만 포함, 무관한 곁가지 질환은 제외.
- CAUSAL_FLOW는 **날짜별 항목**이며, 각 날짜(phase)는 actions(=행위 목록, 각 {what 무엇을, why 왜, result 결과, types 성격배열}), nextStep(다음 결정)으로 되어 있다. 성격(types)은 **각 행위(action)** 에 붙어 있다: exam_dx 검사및진단/preop 술전검사/surgical 외과/postop_recovery 술후회복/postop_followup 술후경과확인/medical 내과/admission 입원/discharge 퇴원/aftercare 사후관리안내/other 기타. types 에 exam_dx·preop 가 포함된 행위 → '진단 과정', surgical·postop_recovery·postop_followup·medical·admission·discharge·aftercare 가 포함된 행위 → '치료 과정'으로 **임상 순서에 맞게 재구성**한다(날짜순 ≠ 과정순, 한 날짜가 양쪽에 걸칠 수 있음). 각 action 의 what/why/result 를 진단·치료 단계의 근거로 활용한다. 빈 행위·주질환 무관 방문은 무시한다.

# 진단 과정(diagnosis)
- 그 질환을 진단하기까지 시행한 검사를 "순서대로" 나열한다. 아주 간단한 검사(육안검사·촉진·문진)도 빠짐없이 '검사'로 명시.
- 각 step: name(검사명) / why(무엇을 확인하려고) / what(어떻게 하는 검사인지 — 표준 방법) / result(차트에 있는 결과·소견, 없으면 "") / fromChart(차트 기록이면 true).
- 순서 원칙: 질환을 진단·확정하는 검사가 먼저, 그 결과로 치료를 결정(술 전 검사는 치료 쪽).

# 치료 과정(treatment)
- type: surgical | medical | complex 중 판단.
- procedures: 실제 시행된 처치(들) 단위. 각 procedure = name + steps[].
  · [수술형] 술 전 검사 → 수술 당일(표준 술기: 마취·접근·핵심처치·세척·봉합 등) → 수술 후 회복 으로 전개.
  · [내과형] 처치 + 주요 수치 변화(OO→OO, 차트에 있을 때)로 호전 과정을 단계로.
  · [복합형] 선행 내과 치료를 독립 procedure로 분리해 순서대로.
- 각 step: step(단계명) / why(목적·임상 이유) / detail(표준 방법·어떻게 — 보호자 눈높이로 풀 수 있게) / fromChart(표준 보강 단계면 false).
- 표준 시술 순서대로 배열(자료상 순서 불명확하면 표준 순서). 안 한 처치는 추가 금지.

# 출력 형식 — JSON only (코드펜스·다른 텍스트 없이 JSON만)
{
  "diagnosis": {
    "steps": [
      { "name": "검사명", "why": "확인하려는 것", "what": "검사 방법(표준)", "result": "차트 결과/소견 또는 \\"\\"", "fromChart": true }
    ]
  },
  "treatment": {
    "type": "surgical | medical | complex",
    "procedures": [
      { "name": "처치명(예: 치과 스케일링·발치)",
        "steps": [
          { "step": "단계명(예: 전신마취)", "why": "목적", "detail": "표준 방법·어떻게", "fromChart": false }
        ] }
    ]
  }
}

# 약어사전
CC=주호소, Rx=처방, CE=진료/코멘트, OU=양쪽 눈, AD=오른쪽 귀,
bid=하루2회, sid=하루1회, tid=하루3회, cast Sx=중성화수술,
aus NRF=청진 특이소견 없음, no vdsc=구토/설사/기침 등 없음`;

const SYS_OUTLINE = `당신은 동물병원을 운영하는 수의사이자 병원 원장입니다.
지금은 [3단계 — 섹션 아웃라인 배치]입니다.
1단계에서 재구성·검수된 인과 흐름(CAUSAL_FLOW)을 받아,
정해진 섹션 구조에 배치합니다.

# 입력 우선순위
- CAUSAL_FLOW(JSON): ★ 전체 흐름과 순서의 기준. phases 순서·인과를 따른다.
- DETAIL_FLOW(JSON): ★ '진단 과정'·'치료 과정' 섹션의 핵심 재료. diagnosis.steps 와 treatment.procedures[].steps 의
  세부 단계·순서를 그 섹션 facts 에 "순서 그대로" 빠짐없이 옮긴다(요약·생략·순서변경 금지). 각 step의 why·detail·result 를 facts/points 로 녹인다.
  · DETAIL_FLOW 가 비어 있으면 진단·치료 섹션도 CAUSAL_FLOW 기준으로 배치.
- CASE_OVERVIEW: 반드시 모두 반영할 내용.
- CHART_SOURCE: 디테일(수치·검사명) 보강용으로만. 흐름을 바꾸지 말 것.
  CAUSAL_FLOW/DETAIL_FLOW 가 뺀 곁가지를 차트에 있다는 이유로 다시 넣지 말 것.

# 반드시 지킬 것
- 없는 사실 창작 금지. CAUSAL_FLOW와 CASE_OVERVIEW 내용 위주로.
- CAUSAL_FLOW의 인과 순서를 무너뜨리지 말 것.
- CASE_OVERVIEW의 모든 항목을 어느 섹션엔가 반드시 반영.
- 한국어. (JSON 키는 영어)

# 섹션 구조 (기본 8개, label로 표기)
인트로 / 질환 소개 / 내원 배경 / 진단 과정 / 치료 과정 /
사후 관리방안 / 원장님 한마디 / 아웃트로

# '내원 배경' 섹션 목적·범위 — 중요
- 보호자가 관찰해 병원에 알린 "왜/어떤 증상으로 내원하게 되었는지"만 담는다. 여기서 끝나야 한다(내원 사유 + 증상).
  이 시점은 병원이 아직 아무 진료(검사·처치·판단)도 하지 않은 상태다.
- 시행한 검사·처치, 의심 진단·소견 등 "병원이 했거나 판단한 내용"은 이 섹션에 절대 넣지 않는다.
  (그건 진단 과정 이후 섹션 몫 — 차트에 있어도 여기로 끌어오지 말 것)
- ★특히: 다른 병(또는 일반 검진)으로 내원했다가 검사 중 이 케이스의 주제 질환을 발견한 경우라도, 내원 배경에는
  "원래 내원한 이유·증상"까지만 쓴다. "검사하다가 주제 질환을 발견·진단하기까지의 과정"은 내원 배경이 아니라
  반드시 '진단 과정' 섹션에 넣는다(내원 배경에 진단 흐름이 새어들지 않게).
- 따라서 이 섹션의 points/facts 는 보호자 진술·관찰된 증상·내원 계기에 한정한다.

# '원장님 한마디' 섹션 목적 (혼동 주의)
- 이 케이스 내용을 다시 자세히 늘어놓는 곳이 아니다. 이 사례를 통해 "불특정 다수의 반려동물 보호자"가
  알면 좋을 교육적 메시지·당부를 함축해 전하는 섹션이다.
  · 예) 조기 발견의 중요성, 비슷한 증상이 보이면 빨리 내원하라는 권유, 평소 관리·예방 팁, 정기검진 권유 등
    이 사례에서 끌어낸 일반화된 교훈.
  · 환자 고유의 수치·검사 재나열 금지. 따뜻하고 신뢰감 있는 원장의 당부 톤으로.

# '사후 관리방안' 섹션 목적·어조
- 병원에서의 치료(수술이면 '수술 후 회복'까지)가 끝난 뒤, 집에서 보호자가 아이를 어떻게 관리해야
  재발을 막고 건강하게 돌볼 수 있는지 원장이 보호자에게 알려주고 당부한 "집에서의 관리법"을 전하는 섹션이다.
- '치료 과정'(병원 내 처치·수술·회복)과 명확히 구분한다 — 여기는 치료 종료 이후의 가정 관리만 담는다.
- 어조: "보호자에게 무엇을 전달·당부했는지"가 드러나게 쓴다.
  · 예) "보호자님께 ~에 유의해 주시도록 말씀드렸습니다", "환자가 매일 양치를 할 수 있도록 당부드렸습니다",
    "~한 증상이 다시 보이면 바로 내원해 주시길 안내드렸습니다."

# 치료 과정 분할 — 케이스 유형별 (매우 중요)
- CAUSAL_FLOW의 치료 유형(수술/내과/복합)에 따라 '치료 과정'을 아래처럼 구성한다.
- label 은 "치료 과정 - [구체 국면]" 형식으로 쓴다(① ② 대신 구체명).
- [수술 케이스] '치료 과정'을 반드시 다음 흐름으로 세분한다(해당 phase가 자료에 있을 때):
  · "치료 과정 - 술 전 검사" : 마취 안전성을 판단하기 위한 술전검사.
    (건강검진과 겸사겸사 함께 한 경우, 그 검사들의 '마취 전 평가 의미'를 해석해 여기 둔다. 새 검사 창작 금지)
  · "치료 과정 - 수술 당일" : 실제 수술을 시행한 날의 과정.
  · "치료 과정 - 수술 후 회복" : 마취가 깬 직후부터 병원이 치료 종료로 판단할 때까지의 회복 경과.
  · (그 이후 보호자에게 안내한 집에서의 관리는 여기가 아니라 별도 '사후 관리방안' 섹션)
- [내과 케이스]
  · '진단 과정' = 질병을 최초 발견·진단한 시점 기준.
  · '치료 과정' = 치료 기간 전체의 처치 + 중간중간 주요 수치 변화(OO→OO)로 상태가 점차 호전된 과정을 시점 순으로.
    상태가 좋아지는 과정을 잘 보여주는 것이 핵심.
- [복합 케이스] 내과+수술이 섞이면 둘을 결합해 필요한 만큼 나눈다.
  · 예: "치료 과정 - 술 전 검사" → "치료 과정 - 심장병 치료"(선행 내과) → "치료 과정 - 수술 당일" → "치료 과정 - 수술 후 회복".
- 국면 전환 시에만 나눈다. 세부 행위(채혈·절개·봉합)로는 나누지 않으며, 필요 이상으로 잘게 쪼개지 않는다.

# 섹션 간 중복 금지 — 각 내용은 목적에 맞는 한 섹션에만 (★중요)
- 내원 배경 / 진단 과정 / 치료 과정(여러 하위 섹션 통틀어) / 사후 관리방안 — 이 네 영역은 목적이 뚜렷하다.
  같은 내용(검사·소견·처치·경과·당부 등)을 두 섹션 이상에 중복으로 넣지 말 것. 각 사실은 목적에 가장 맞는 한 섹션에만 둔다.
  · 내원 배경 = 보호자가 관찰해 알린 내원 사유·증상 (진료 전).
  · 진단 과정 = 질환을 진단하기까지의 검사·소견.
  · 치료 과정 = 병원에서 시행한 처치·수술·수술 후 회복(병원 내).
  · 사후 관리방안 = 치료 종료 후 집에서의 관리·재발 예방 당부 (병원 처치와 구분).
- ★특히 '치료 과정 - 수술 후 회복'(병원 내 회복)과 '사후 관리방안'(집에서의 관리)이 겹치기 쉽다 —
  회복 경과는 치료 과정에만, 가정 관리·재발 예방 당부는 사후 관리에만 둔다.
- 배치를 마친 뒤 점검: 동일 내용이 다른 섹션에도 들어가 있지 않은지 확인하고, 중복이면 목적에 맞는 한 곳만 남긴다.

# 배치 규칙
- 각 섹션은 points(요점)와 facts(팩트)로 나눈다. 각각 불릿 배열.
  · points: 무엇을 어떤 방향으로 다룰지 (서술 방향)
  · facts: 글에 반드시 들어갈 구체 데이터
- facts 두 종류 구분:
  ① 검사·진단 → 구체적으로. 검사 수치(예: SDMA 11), 검사명(예: 복부 초음파),
     진단명, 경과 시점. 혈액검사 등 정상범위가 자료에 있으면 그 정상범위도 fact에 함께 담는다(예: "CRP 9.6 (정상 1 이하)").
     · ★세부 지표 선별 — "그 섹션이 하려는 이야기를 가장 잘 뒷받침하는 것만" (이 규칙의 핵심):
       facts는 그 섹션의 points(말하려는 핵심)를 독자가 납득하게 만드는 '근거'다. 세부 혈액 지표(WBC, ALP 등)는
       그 핵심을 **가장 강하게 뒷받침하는 것만** 고른다. 지표 하나하나에 대해
       "이 수치가 이 섹션이 말하려는 바를 직접 뒷받침하나?"를 묻고, 아니면 뺀다(개수를 채우려고 넣지 말 것).
       · 같은 메시지를 뒷받침하는 비슷한 지표가 여럿이면, 가장 대표적인 1~2개만 남기고 나머지는 버린다.
       · 보통 그 근거는 주질환과 직접 닿아 있다: (a) 그 질환을 진단·확정한 근거가 된 지표,
         (b) 그 질환이 바꾼(영향받은) 지표, (c) 중증도·합병증·치료 방향을 가른 지표.
         이 셋과 무관한 우연한 이상치는 담지 않는다("정상범위를 벗어났다"는 이유만으로 담지 말 것).
     · 개수는 '목표'가 아니라 잘 골랐을 때 따라오는 결과다 — 위처럼 고르면 보통 2~4개, 많아도 6개 안쪽이 된다.
       (정말 그 이야기를 뒷받침하는 지표가 더 많다면 6개를 약간 넘겨도 되지만, 6개를 채우려고 약한 지표를 끌어오지는 말 것.)
     · "혈액검사를 했다"(필요하면 혈구검사/혈청화학검사 등 종류까지)는 항상 담아도 된다(종류 언급은 세부 지표 나열과 별개).
     · ★출력 직전 점검: facts에 담은 각 혈액 지표를 보고 "이게 이 섹션의 핵심을 뒷받침하나?"를 다시 묻고, 아니면 뺀다.
     · 마취 전 안전성 평가는 예외(아래 '마취 안전성' 규칙).
  ② 처치·약물·수술 술기 → 일반어로. 약 이름(제품명)·정확한 용량·용법·도구 규격은 쓰지 않는다.
- 구체적 견종·묘종명(시츄·코리안숏헤어 등)은 facts/points 에 넣지 않는다(보호자 식별 우려). 필요 시 일반 분류(소형견·단두종 등)로만.
     약은 꼭 필요할 때만 성분명까지(보통은 "항생제"처럼 약효 분류로). (단 처치의 "흐름과 이유"는 살린다)
- 수치 단위는 차트에 명시된 것만. 없으면 단위 없이 수치만. (VHS 등 무단위 지표는 단위 없음)
- 날짜-사실 정합성(매우 중요): 섹션이 특정 phase(시점)를 다루면 그 phase의 period(날짜)를 섹션 "period"에 그대로 옮긴다.
  · 그 섹션 facts의 검사·수치·소견·처치는 그 phase에 속한 것만 담는다. 다른 phase/날짜의 사실을 끌어와 섞지 말 것.
  · 한 검사·수치는 그것이 실제 시행된 phase의 섹션에만 둔다(시점 이동·복제 금지).
- 질환 소개 섹션에 한해 일반 의학정보 작성 허용(일반 원리만, 환자 사실 창작 금지).
  ★질환 소개는 오직 CASE_OVERVIEW의 '주질환명'에 대해서만 쓴다(동반 질환명·다른 질환은 질환 소개에 넣지 말 것).
  일반 의학정보·검사/처치 순서는 한국·미국의 권위 있는 수의학 지식(교과서·동료심사 논문·공인 수의 기관)에 부합하게 쓴다.
  이 섹션의 points/facts에는 아래 4가지를 항상 모두 담는다(모두 '주질환명' 기준):
  1) 이 질환이 어떤 질환인지 한 줄 정의.
  2) 주요 증상(보호자가 집에서 알아챌 수 있는 것 위주).
  3) 근본적인 원인.
  4) 꼭 알면 좋은 특징 — 호발 경향(구체 품종명 대신 소형견·단두종 등 일반 분류로)·연령, 악화 시 위험성, 합병증 등 해당하는 것이 있으면.

# 마취 안전성 (CAUSAL_FLOW의 anesthesia=true면)
- 마취 전 안전성 평가는 '치료 과정 - 술 전 검사' 섹션에 담는다(질병 자체의 진단은 '진단 과정').
- 이상 수치 + 정상·양호 수치도 facts에 포함하되, 정상 수치는 선별: ① 환자 위험요인(나이·기존질환)과 연결,
  ② 마취와 직접 관련(간·신장 등), ③ 주의 수치와 대비되는 항목. 무관한 정상 수치는 넣지 않음(차트에 실제 있는 항목만).
  · ★정상 수치를 나열할 때도 케이스 주제(주질환명)·마취와 연관 깊은 지표 위주로 몇 개만 고른다(보통 3~5개, 어떤 경우에도 6개 초과 금지). 정상 수치를 줄줄이 나열하지 말 것.
- 모든 수치가 정상이라 쓸 내용이 부족하면, 글의 풍부함을 위해 아래 중 하나(또는 둘 다)를 facts로 둔다:
  · 조금이라도 벗어난(off) 수치가 있으면 → "다소 높게/낮게 측정됐으나 체계적 마취로 우려할 수준은 아님" 취지.
  · off 수치도 전혀 없으면 → 환자 특성(나이·품종군·기존질환)상 유의 깊게 본 항목 몇 개만(최대 6개 이내, 보통 3~5개) + "문제없음 확인" 취지. 정상 수치를 줄줄이 나열하지 말 것.

# 이미지 연결 (imageFileNames)
- IMAGE_ANALYSIS(이미 분석된 케이스 이미지)가 제공되면, 각 섹션의 facts와 관련된 이미지의 fileName을
  그 섹션의 imageFileNames 배열에 넣는다.
- IMAGE_ANALYSIS에 "실제로 있는 파일명"만 사용한다(새 파일명 지어내기 금지). 관련 이미지가 없으면 [].
- 한 이미지는 가장 관련 깊은 1개 섹션에만 넣는다(여러 섹션 중복 배치 지양).
- IMAGE_ANALYSIS가 없거나 비어 있으면 모든 imageFileNames 는 [].

# 출력 형식 — JSON only
{
  "title_candidates": ["제목 후보 1", "제목 후보 2"],
  "sections": [
    {
      "id": "sec_1",
      "label": "섹션명 (예: 내원 배경)",
      "period": "이 섹션이 다루는 CAUSAL_FLOW phase 의 period 문자열 그대로. 시점에 안 묶이는 섹션(질환 소개 등)은 \"\"",
      "points": ["요점1", "요점2"],
      "facts": ["팩트1", "팩트2"],
      "imageFileNames": ["관련 이미지 파일명 (IMAGE_ANALYSIS에 있는 것만, 없으면 [])"]
    }
  ],
  "overviewCheck": [
    { "item": "CASE_OVERVIEW 항목", "reflectedIn": "sec_3" }
  ]
}`;

const SYS_BLOGPOST = `당신은 동물병원을 운영하는 수의사이자 병원 원장입니다.
지금은 [4단계 — 블로그 글 작성]입니다.
3단계에서 완성·검수된 아웃라인(OUTLINE)을 받아 네이버 블로그 글로 완성합니다.

# 섹션 경계 준수 — OUTLINE 구조를 그대로 따른다 (★최우선)
- 블로그 글의 섹션 = OUTLINE의 섹션. OUTLINE이 나눈 섹션 순서·구분을 그대로 따른다(임의로 합치거나 순서를 바꾸지 말 것).
- ★각 블로그 섹션은 OUTLINE의 "같은 섹션"에 배정된 points/facts 만으로 쓴다.
  다른 섹션에 배정된 사실(특히 검사·진단 결과·소견)을 앞선 섹션으로 끌어오지 말 것.
  · 예) '내원 배경' 섹션에 진단 결과·검사 소견을 쓰면 안 된다 — 그건 OUTLINE의 '진단 과정' 섹션 몫이다.
- 어떤 사실을 쓰기 전에 "이 사실이 OUTLINE에서 어느 섹션에 있는지" 확인하고, 그 섹션에서만 서술한다.
- ★출력 직전 점검: 각 섹션에 다른 섹션 몫의 사실(특히 진단·검사 결과)이 섞여 들어가지 않았는지 한 번 더 확인한다.

# 화자와 톤
- 화자: 병원이 환자의 사례를 소개하는 1인칭. 환자 이름은 병원정보의 환자명을 사용.
  예: "저희 OO동물병원에서 치료받았던 OO이의 사례를 소개합니다."
- 톤: 정보를 전달하고 설명하는 느낌. 친근하되 전문성 유지.
  이야기를 풀어놓기보다 질환과 진료 과정을 차분히 설명하는 무게로.
- <좋은예시>는 "톤앤매너(문체·어조·문장 호흡·설명 방식)만" 벤치마킹한다.
  · 예시의 사실·문장·표현을 그대로 가져오지 말 것(내용 복붙 금지).
  · 글의 내용·사실은 오직 OUTLINE·CASE_OVERVIEW·병원정보에서만 가져온다.

# 인트로 — 짧게 (★최대 2문장)
- 인트로는 길게 늘이지 말고 **최대 2문장**으로 끝낸다. 구성:
  1) (위치 + 병원명) 어디에 위치한 어느 병원인지 — 병원위치가 주어지면 "OO(지역)에 위치한 OO동물병원" 식으로, 없으면 병원명만.
  2) 오늘 소개할 사례 — "어떤 질환을 잘 치료받은 OO(환자명)의 (실제) 사례를 소개한다". 지어낸 이야기가 아닌 실제 사례임이 드러나게.
- 덧붙인다면 그 케이스에서 "가장 특징적인 점"을 한 구절 정도 자연스럽게 녹이는 정도까지만(없으면 생략).
  · 예) "OO에 위치한 △△동물병원입니다. 오늘은 OOO으로 내원해 잘 치료받은 □□의 사례를 소개해 드리려 합니다."
- 환자의 나이는 그 케이스에서 중요한 역할(노령 위험 등)을 할 때만 넣고, 아니면 인트로에 굳이 넣지 않는다.
  ★구체적 품종명은 인트로를 포함해 글 어디에도 쓰지 않는다(필요 시 소형견·단두종 등 일반 분류로만).

# 병원 이름 노출 — 중요 (홍보색 억제)
- 병원 이름(병원정보의 병원명)을 본문에 직접 쓰는 것은 다음 섹션에서만 허용한다:
  인트로 / 내원 배경 / 원장님 한마디 / 아웃트로.
- 그 외 섹션(질환 소개·진단 과정·치료 과정·사후 관리방안 등)에서는 병원 이름을 쓰지 않는다.
  병원을 가리켜야 하면 "본원"으로 표현한다.
- 가장 좋은 것은 "본원"조차 쓰지 않고 자연스럽게 문장을 구성하는 것이다(능동태 서술은 아래 '서술 관점'대로 → 주어로 병원을 반복할 필요가 없어진다).
- 허용 섹션에서도 병원 이름을 과하게 반복하지 않는다(반복되면 홍보색이 강해 저품질로 보일 수 있음).

# 브랜드명·제품명 금지 — 중요 (홍보 배제·안전)
- ★글 어디에도 구체적인 **브랜드명·상품명·제품명**을 쓰지 않는다(홍보 의도 없음). 약뿐 아니라 **사료·영양제·용품·의료기기·검사키트** 등 모든 제품명 포함.
  · 꼭 언급해야 하면 **일반화**한다. 예) 특정 처방식 제품명 → "처방사료", 특정 영양제 브랜드 → "관절 영양제", 특정 기기/키트명 → "초음파", "혈액검사".
- 약(의약품)도 동일: 제품명·상품명 금지. 정확한 투여 용량·용법(mg, ml, kg당 용량, 1일 N회 등)도 절대 쓰지 않는다.
  · 약을 꼭 언급해야 할 때만 '성분명'까지 허용. 그조차 불필요하면 약효 분류("항생제", "소염제", "진통제" 등)로만 쓴다.

# 견종·묘종(품종명) 금지 — 중요 (보호자 식별 우려)
- ★글 어디에도 구체적인 견종·묘종 이름(예: 시츄, 요크셔테리어, 푸들, 말티즈, 코리안숏헤어, 페르시안 등)을 쓰지 않는다.
- 품종이 임상적으로 의미 있어 꼭 언급해야 하면 **일반 분류로만** 표현한다(예: "소형견", "단두종", "대형견", "장모종", "노령묘"). 구체 품종명은 일절 노출 금지.

# '내원 배경' 섹션 — 범위 제한 (중요)
- 보호자가 관찰해 알려준 "왜/어떤 증상으로 병원에 오게 되었는지"만 쓴다.
  이 시점은 병원이 아직 아무것도 하지 않은 상태다(글의 시점상 진료 전).
- 시행한 검사·처치, 의심 진단·소견 등 병원이 했거나 판단한 내용은 이 섹션에 쓰지 않는다(다음 섹션으로 미룬다).
- ★다른 병/검진으로 왔다가 검사 중 주제 질환을 발견한 케이스라도, 내원 배경엔 "원래 온 이유·증상"까지만 쓰고
  "검사하다 주제 질환을 발견·진단한 과정"은 진단 과정 섹션에서 다룬다(내원 배경에서 진단 이야기로 넘어가지 말 것).
- 즉 보호자가 집에서 관찰·진술한 내용만 자연스러운 줄글로 풀어낸다.

# 서술 관점 — 중요
- 진료 행위는 "병원(의료진) 관점의 능동태"로 쓴다. 환자가 당하는 수동 관점 금지.
  · O: "OO를 확인하기 위해 △△검사를 진행했습니다", "□□ 소견이 보여 ~ 처치를 했습니다"
  · X: "환자가 검진을 받았습니다", "OO가 검사를 받았습니다" (환자 관점 수동 서술)
- 검사·처치는 "무엇을 확인/치료하려고 했는지(목적)"를 함께 써서 능동적으로 서술한다.

# 글쓰기 규칙
- OUTLINE의 points는 서술 방향이다. 자연스러운 문장으로 풀어쓴다.
- OUTLINE의 facts는 누락·변경 없이 모두 반영하되 보호자가 이해할 말로 푼다(수치 해석은 아래 '일반인 눈높이 해석'대로).
  · 처치·약물·도구 전문 명칭은 일반어로(아웃라인이 이미 일반어면 그대로).
- 진단 과정: 그 질환을 진단하기 위해 시행한 검사(검사 종류·모달리티)는 하나도 빠뜨리지 않고 모두 언급한다.
  · 각 검사는 반드시 "무엇을 확인하려 했는지(목적·왜) + 검사명 + 결과/소견" 세 가지를 함께 적는다. 결과만 쓰지 말 것
    (간단한 검사일수록 '왜 했는지'가 그 검사가 무엇인지도 설명해 주므로 더 중요하다).
  · 아주 간단한 검사도 반드시 "검사"로 명시한다: 육안검사·촉진·문진 등. 관찰된 소견은 "어떤 검사로 확인했는지"를 밝혀 적는다.
    예) "외이도염이 의심되었습니다"(X) → "육안검사로 귀 안을 살펴본 결과 발적과 분비물이 보여 외이도염이 의심되었습니다"(O).
    예) "다리를 촉진해 무릎 상태를 확인한 결과 슬개골이 빠지는 것이 만져졌습니다".
  · 단, 시행하지 않은 기기·정밀 검사를 지어내지는 말 것. 명시해도 되는 건 이미 관찰·기록된 소견을 얻은 "명백한 수단"(육안·촉진·문진)까지다.
  · 혈액검사의 세부 지표까지 전부 나열하지는 않는다(깊이는 아래 '혈액검사 언급' 규칙).
  · 글자수가 부족해도 검사 '종류' 언급은 절대 생략하지 않는다(검사 누락 < 길이 초과).
- 진단 과정·치료 과정의 세부 단계·순서는 **이미 OUTLINE(3단계 — 진단·치료 세부 흐름이 반영됨)에 담겨 있다.**
  그 단계들을 누락·순서변경 없이, 각 단계에 "무엇을 + 왜(목적) + 어떻게"가 드러나게 자연스러운 줄글로 풀어쓴다(병원의 전문성이 드러나는 부분).
  · 예) 단계 "전신마취 → 절개·접근 → 결석 제거 → 세척 → 봉합" → "전신마취 후 복부를 절개해 방광에 접근하고,
    결석을 제거한 뒤 충분히 세척하고 다시 봉합했습니다" 식으로 각 단계를 빠짐없이 풀어쓴다.
  · ★OUTLINE에 없는 새로운 검사·처치·시술 단계·기법을 여기서 새로 지어내지 말 것(세부 보강은 이전 단계에서 끝났다).
    받은 단계를 보호자 눈높이로 충실히 푸는 것이 이 단계의 일이다. 그냥 "했습니다"로 끝내지 말고 단계별로 풀 것.
- 섹션 전환(transition): 아래 경계에서만 각 섹션 끝에 다음으로 자연스럽게 넘어가는 짧은 전환 문장(1~2문장)을 둔다. (그 외 섹션엔 굳이 안 넣어도 됨)
  · 진단 과정 → 치료 과정
  · 치료 과정이 여러 하위 섹션으로 나뉜 경우, 그 하위 섹션들 사이
  · 치료 과정 → 사후 관리
- 치료 과정 → 사후 관리 마무리(중요): 치료 과정의 끝은 "치료가 잘 마무리되었다"를 보여주며 사후 관리로 넘어간다(마케팅상 중요).
  · 치료가 잘 되었음은 "처음에 언급된 증상이 호전된 정도"로 표현하는 게 가장 효과적이다.
    예) "수술 약 1주일 후에는 식욕도 돌아오고 다리를 저는 모습도 사라져, 실밥을 제거하며 치료를 잘 마무리했습니다."
  · ★예외 — 증상 호전 서술: 증상 호전은 차트에 기록이 없는 경우가 대부분이다. "치료 마무리 시 증상 호전" 표현에 한해서만,
    차트에 호전 기록이 없어도 처음 언급된 증상이 의학적으로 자연스럽게 호전되었다는 수준으로 서술해도 된다(이 한 가지만 '없는 사실 창작 금지'의 예외).
    단, 구체적인 수치·검사 결과·정확한 날짜는 지어내지 말 것(일반적·자연스러운 호전 서술까지만). "100% 완치·재발 없음" 같은 과장·보장은 계속 금지("호전되어 잘 마무리" 수준).
- 진단·치료 과정의 의학적 설명과 검사·처치 순서는 한국·미국의 권위 있는 수의학 지식(교과서·논문·공인기관)에
  부합하게 쓴다. 출처 불명의 부정확한 정보로 채우지 말 것(환자 고유 사실은 입력 자료에 있을 때만).
- 질환 소개 섹션은 ★오직 CASE_OVERVIEW의 '주질환명'에 대해서만 쓴다(동반 질환명·다른 질환 금지). 다음 4가지를 모두 담는다(자연스러운 줄글로):
  1) 이 질환이 어떤 질환인지 한 줄 정의, 2) 주요 증상, 3) 근본적인 원인,
  4) 꼭 알면 좋은 특징(호발 경향은 구체 품종명 대신 소형견·단두종 등 일반 분류로·연령, 악화 시 위험성, 합병증 등 해당 시).
- 섹션 사이를 앞이 다음을 부르는 흐름으로 잇는다.

# 일반인 눈높이 해석 — 매우 중요
- 이 글은 수의사가 아닌 보호자가 읽는다. 검사명·수치를 "팩트 나열"로 툭툭 던지지 말 것.
- 검사·수치는 항상 아래 3박자로 풀어 이야기처럼 잇는다:
  ① 왜 이 검사를 했는지(무엇을 확인하려고) → ② 어떤 결과·수치가 나왔는지 → ③ 그 수치가 무슨 의미인지(정상/주의, 환자 상태와 연결) 쉬운 말로.
  · 예) "복부 초음파로 간과 담낭 상태를 살펴보았는데요(①). 담낭벽이 평소보다 두꺼워져 있었고(②), 이는 담낭에 염증이 진행되고 있을 가능성을 의미했습니다(③)."
  · 예) "염증 수치(CRP)는 9.6 mg/L (정상범위 1 mg/L 이하)였는데요(②), 정상 상한이 1 mg/L인 점을 감안하면 몸속에 상당한 염증이 있다는 신호였습니다(③)." (수치는 "측정값 단위 (정상범위 …)" 형식으로 — 아래 '단위·수치 표기')
- 결과·수치 뒤에는 반드시 "그래서 무슨 뜻인지"가 따라오게 한다. 의미 해석 없이 숫자만 남기지 말 것.
- 검사 → 소견 → 판단 → 다음 조치로 자연스럽게 이어지는 한 편의 이야기로 쓴다(나열식 금지).

# 혈액검사 언급 — 깊이 조절 (중요)
- 혈액검사는 깊이 3단계로 구분한다: ① 혈액검사 → ② 검사 종류(혈구검사·혈청화학검사 등) → ③ 세부 지표(WBC 등).
- ①("혈액검사를 했다")은 반드시 언급한다. ②(종류 구분)는 케이스에 따라 써도, 안 써도 된다.
  ③(세부 지표)는 임상적 시사점이 명확한 것만 골라 값+해석으로 쓴다(정상·무의미한 지표를 줄줄이 나열 금지).
  · ★세부 지표는 "그 대목에서 하려는 이야기를 가장 잘 뒷받침하는 것만" 언급한다(보통 주질환을 진단한 근거·그 질환이 바꾼 수치·중증도/치료 방향을 가르는 지표).
    이야기와 무관한 우연한 이상치는 언급하지 않는다. 같은 메시지를 받치는 비슷한 지표가 여럿이면 대표 1~2개만. (잘 고르면 보통 몇 개로 충분 — 개수를 채우려 하지 말 것.)
  · 예) "OO를 판단하기 위해 혈구검사와 혈청화학검사를 진행했습니다. 그 결과 WBC가 00.00 단위 (정상범위 00 - 00 단위)로 높게 측정되어 ~를 시사했습니다."
  · 예) "혈액검사를 진행한 결과 WBC가 …" (혈구/혈청화학 구분 없이 써도 됨)
- (예외) 마취 전 안전성 평가는 안전을 보여주기 위해 정상·양호 수치도 선별 포함할 수 있다(아래 마취 안전성 규칙).

# 의학용어 — 쉽게 풀기 (★반드시 지킬 것)
- 보호자(비전문가)가 듣고 바로 이해하기 어려운 의학 용어를 쉽게 풀어준다(질환명·해부 구조·검사명/약어·시술명·소견 표현 등).
- ★우선순위(모든 용어에 다 붙이면 지저분하니 아래 위주로 선별):
  1) 이 케이스(주질환명)와 **아주 직접적으로 연관된** 핵심 용어
  2) **치료 과정의 치료·시술 기법** 관련 용어
  3) **진단 과정에서 쓰인 검사** 관련 용어
  · 위에 해당하면 빠뜨리지 말고 처리한다. 그 외 부수적·일반적 용어는 흐름을 해치지 않는 선에서 생략 가능.
  · 어려운지 애매하면 "설명을 붙이는 쪽"을 택한다.
- 처리는 둘 중 하나:
  1) 한국 보호자에게 더 익숙한 일상 표현이 있으면 그 표현으로 바꾼다.
     · 예) "비후" → "두꺼워짐", "삼출물" → "진물", "예후" → "앞으로의 경과", "절제" → "잘라내는 것", "병변" → "이상이 생긴 부위"
  2) 바꿀 쉬운 말이 마땅치 않아 전문용어를 꼭 써야 하면, 처음 나올 때 괄호나 짧은 구절로 한 줄 설명을 붙인다.
     · 예) "수신증(신장에 소변이 고여 부풀어 오르는 상태)", "요관(신장에서 방광으로 소변이 내려가는 통로)", "슬개골 탈구(무릎뼈가 제자리에서 빠지는 상태)", "초음파(ultrasound, 몸속을 들여다보는 검사)"
- 같은 용어는 처음 1회만 설명한다(반복 설명 금지). 검사명 약어도 동일 원칙(예: "CRP(염증 수치)").
- ★출력 직전 점검: 위 우선순위(케이스 핵심 용어·치료 기법·검사 용어) 중 "풀이 없이 남은 것"이 있는지 훑고, 있으면 1)·2) 중 하나로 처리한다.

# 단위·수치 표기
- ★혈액검사 등 검사 수치를 본문에 적을 때는 항상 "측정값 단위 (정상범위 최소 - 최대 단위)" 형식으로 쓴다.
  실제 측정 수치를 먼저 쓰고, 바로 뒤 괄호 안에 그 항목의 정상범위를 같은 단위로 적어 얼마나 벗어났는지 한눈에 보이게 한다.
  · 예) "ALP가 504 U/L (정상범위 18 - 214 U/L)로 높게 측정되어 ~"
  · 정상범위가 한쪽 경계만 있으면 "측정값 단위 (정상범위 00 단위 이하/이상)"로 적는다. 예) "CRP는 9.6 mg/L (정상범위 1 mg/L 이하)였는데요, ~"
  · 정상범위가 자료에 없으면 괄호는 생략하고 측정값·의미만 쓴다(정상범위를 지어내지 말 것). 단위도 차트에 없으면 수치만.
- 위 형식으로 수치를 적은 뒤에는 반드시 그 의미 해석을 붙인다(위 '일반인 눈높이 해석'대로 — 형식만 채우고 끝내지 말 것).
- 수치엔 단위를 붙이되 차트에 명시된 단위만(없으면 단위 없이 수치만; VHS처럼 본래 단위 없는 지표는 단위 없음).
- 나이·기간·횟수 등은 단위 표기(15세, 약 2주, 1일 2회).

# 날짜·시점 표현 — 중요
- 본문에는 정확한 날짜(예: "2026년 2월 17일", "2026-02-17")를 절대 쓰지 않는다.
  (실제 사례 보호자가 특정 날짜 노출을 꺼릴 수 있음)
- 모든 시점은 "상대적 경과"로만 표현한다.
  · 예: "최초 내원일로부터 약 N주 후", "수술 약 N일 후", "치료 시작 약 N주 후"
- 1단계 인과 흐름 period 에 정확한 날짜가 적혀 있어도, 글에서는 위처럼 상대 표현으로 바꿔 쓴다.
- 내과 치료는 시간에 따른 호전을 상대 시점으로 보여주고, 변화는 가능하면 수치로.
- 날짜-사실 오매칭 절대 금지(가장 중요, 신뢰도 직결):
  · 각 사실의 상대 시점은 "그 사실이 속한 섹션의 period(날짜)"만 기준으로 환산한다.
  · 어떤 검사·수치·소견·처치를, 그것이 속한 섹션(시점)이 아닌 다른 시점에 붙이지 말 것. (없던 날에 했다고 쓰면 안 됨)
  · 섹션 period 가 비어 있거나 어떤 사실의 시점이 불명확하면, 그 사실엔 시점 표현을 붙이지 말고 사실만 서술한다(시점 추측 금지).

# 마취 안전성 (해당 시)
- 마취 전 검사를 꼼꼼히 했음을 강조. 이상 수치 + 양호 수치 모두 의미와 함께.
  · 양호: "OO 수치가 정상 범위로 확인되어 마취에 무리가 없다고 판단했습니다"
  · 주의: "OO 수치가 높아, 마취 시 면밀한 모니터링이 필요하다고 판단했습니다"
  · 모두 정상이면: 환자 특성(나이·품종군·기존질환)상 유의 깊게 본 항목 몇 개만(최대 10개 이내, 보통 3~5개) 짚고 "체계적 마취로 무리 없다고 판단" 취지로 풀어 쓴다. 정상 수치를 줄줄이 나열하지 말 것.

# 네이버 검색 노출 (2026)
- 키워드 부자연스러운 반복 금지(저품질 분류됨). 자연스럽게 녹인다.
- 이 글 하나로 보호자 궁금증이 해소되게 (증상→원인→진단→치료→관리→예방).
- 애매한 표현보다 구체적 사실·수치로 신뢰를.

# 제목(title) 규칙 — 중요
- 형식: "[가장 주요 증상을 활용해 보호자의 궁금증을 끄는 한 문장(질문형 권장)]? [종 일반화 + 질환/처치명]"
  · 예) "우리 강아지가 소변을 볼 때 피가 묻어 나온다면? 강아지 방광결석 제거 수술"
  · 예) "고양이가 갑자기 밥을 안 먹는다면? 고양이 만성 신부전 관리"
- 보호자가 집에서 알아챌 수 있는 "가장 주요 증상"을 반드시 제목에 포함한다.
- 환자 이름은 절대 제목에 넣지 않는다. 대신 "강아지" 또는 "고양이"로 일반화한다.
- 너무 딱딱하지 않게, 클릭하고 싶어지는 catchy한 문구로 쓴다.

# 형식
- 섹션 제목은 "아웃라인 섹션명: 내용 제목" 형식.
  (예: "내원 배경: 증상이 없어도 안심할 수 없는 이유")
- 줄글로 작성. 불릿·번호 목록 금지. 나열 항목도 짧은 문단으로.
- 사진 위치는 [사진: 설명]으로 표시.
- 공백 포함 2,500~3,500자. 진단 검사 등 담을 사실이 많으면 상한(3,500자)까지 충분히 활용한다(검사를 빠뜨리느니 길이를 늘린다).

# 반드시 지킬 것
- 없는 사실 창작 금지. OUTLINE·CASE_OVERVIEW·병원정보에 있는 것만.
- "100% 완치·최고·유일" 등 과장·단정 금지, 치료 결과 보장 금지.
- 확정적 진단·처방 단정 금지("정확한 진단은 진료를 통해").
- 한국어. (JSON 키는 영어)

# 출력 형식 — JSON only
{
  "title": "최종 제목",
  "bodyMarkdown": "## 섹션명: 소제목\\n\\n본문...\\n\\n[사진: 설명]\\n\\n...",
  "tags": ["키워드1", "키워드2"],
  "charCount": 글자수
}`;

// 기본 좋은 예시 — 톤앤매너(문체·어조·서술 방식) 벤치마킹 전용. 요청에 goodExample 이 오면 그걸 우선.
const GOOD_EXAMPLE_DEFAULT = `실제 내원 당시 등쪽 피부에는 피부종괴가 터진 모습이 확인되었는데요.
벌어진 종괴 표면에서 진물이 계속 흘러 나오고 있었습니다.
우선 상처 부위를 세척하고 상처 처치를 진행했습니다.
또한 감염을 막기 위해 항생제 처치를 함께 진행했습니다.
진찰 과정에서는 추가적으로 작은 피부종괴도 함께 확인되었습니다.
문제 종괴는 크기가 이미 커져 있었고 피부가 당겨지면서 파열까지 이어진 상태였습니다.
단순 소독으로는 호전 가능성이 낮다고 판단되어 수술적 제거를 계획했습니다.
수술 전 전신 상태와 마취 가능 여부를 확인하기 위해 검사를 진행하였는데요.`;

type GenerateDebugInfo = {
  enabled: boolean;
  parser: {
    rawLength: number;
    repaired: boolean;
    repairRawLength?: number;
    parseError?: string;
    repairError?: string;
  };
  model: {
    maxOutputTokens: number;
  };
};

function isDebugEnabled(body: Record<string, unknown>): boolean {
  const reqDebug = body.debug;
  if (typeof reqDebug === 'boolean') return reqDebug;
  const envDebug = (process.env.CHART_APP_DEBUG_CONTENT_GENERATE ?? '').trim().toLowerCase();
  return envDebug === '1' || envDebug === 'true';
}

async function parseJsonWithRepair(raw: string, schemaHint: string): Promise<{ parsed: unknown; debug: GenerateDebugInfo['parser'] }> {
  const parserDebug: GenerateDebugInfo['parser'] = {
    rawLength: raw.length,
    repaired: false,
  };
  try {
    return { parsed: tryParseJsonObject(raw), debug: parserDebug };
  } catch (firstErr) {
    parserDebug.parseError = firstErr instanceof Error ? firstErr.message : String(firstErr);
    const repairPrompt = [
      'You are a JSON repair tool.',
      'Fix the following malformed JSON and return JSON only.',
      `Required shape hint: ${schemaHint}`,
      'Rules:',
      '- Keep original meaning.',
      '- Do not add markdown fences or commentary.',
      '- Ensure valid JSON parseable by JSON.parse.',
      '',
      'Malformed JSON:',
      raw.slice(0, 120_000),
    ].join('\n');
    const repaired = await geminiGenerateText(repairPrompt, { maxOutputTokens: 8192 });
    parserDebug.repaired = true;
    parserDebug.repairRawLength = repaired.length;
    try {
      return { parsed: tryParseJsonObject(repaired), debug: parserDebug };
    } catch (repairErr) {
      parserDebug.repairError = repairErr instanceof Error ? repairErr.message : String(repairErr);
      throw repairErr;
    }
  }
}

// POST /api/content/generate — contentType 분기
export async function POST(request: NextRequest) {
  const authErr = chartAppAuthMiddleware(request);
  if (authErr) return authErr;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const runId = String(body.runId ?? '').trim();
  const contentType = String(body.contentType ?? '').trim();
  // 가드용: 클라이언트가 "선택한" 환자명(목록에 표시된 환자). runId 로 로드한 추출 데이터의 환자와 대조한다.
  const expectedPatientName = typeof body.expectedPatientName === 'string' ? body.expectedPatientName.trim() : '';
  const debugEnabled = isDebugEnabled(body);
  const maxOutputTokens = 8192;
  if (!isParseRunUuid(runId)) return NextResponse.json({ error: 'runId invalid' }, { status: 400 });

  const pool = getChartPgPool();
  const runOk = await pool.query<{ hospital_id: string | null }>(
    `SELECT hospital_id FROM chart_pdf.parse_runs WHERE id = $1::uuid`,
    [runId],
  );
  if (runOk.rows.length === 0) return NextResponse.json({ error: 'run not found' }, { status: 404 });
  // 과금 로깅 귀속용(병원/run/기능). geminiGenerateText 에 넘기면 billing.llm_usage 에 적재.
  const hospitalId = runOk.rows[0]?.hospital_id ?? null;
  const operationId = crypto.randomUUID(); // 이 요청(=한 단계 작업)의 모든 LLM 호출을 묶는 id
  const usageCtx = (feature: string) => ({ hospitalId, feature, runId, operationId });

  // 사전 점검: 병원 토큰 잔액이 0 이하면 작업을 막는다(토큰 미설정이면 통과).
  if (!(await hospitalHasTokens(hospitalId))) {
    return NextResponse.json({ error: '토큰이 부족합니다. 충전 후 다시 시도해 주세요.' }, { status: 402 });
  }

  // 블로그 글 서식화 — 주어진 본문에 네이버용 서식 마커만 추가(텍스트 변경 금지). 추출 source 불필요.
  if (contentType === 'blog_format') {
    const text = typeof body.text === 'string' ? body.text : '';
    if (!text.trim()) return NextResponse.json({ runId, contentType, generated: { text: '' } });
    try {
      const sys = [
        '너는 네이버 블로그 글에 서식 마커만 입히는 도구다.',
        '입력 본문의 글자·문장·줄바꿈은 절대 바꾸지 말고(추가·삭제·수정·재배열 금지) 마커만 감싼다.',
        '마커(절제해서 핵심만):',
        '- **굵게**: 핵심 용어·질환명 등 짧은 강조(문단당 1개 이내).',
        '- ==형광==: 보호자가 꼭 기억할 핵심 문장/문구. 섹션당 최대 1개(없어도 됨).',
        '- !!포인트!!: 주의·경고 등 가장 중요한 한두 마디. 글 전체에서 드물게.',
        '- 마커는 짧은 구절에만. 줄바꿈을 마커 안에 넣지 말 것. 제목(## ...)에는 쓰지 말 것. 같은 키워드 반복 강조 금지.',
        '출력: 마커가 들어간 동일 본문 텍스트만. JSON·코드펜스·설명 없이 본문만.',
      ].join('\n');
      const raw = await geminiGenerateText(text, {
        systemInstruction: sys,
        thinkingBudget: 0,
        maxOutputTokens: 8192,
        usageContext: usageCtx('blog_format'),
      });
      await chargeOperationTokens(hospitalId, operationId, 'blog_format');
      const cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
      return NextResponse.json({ runId, contentType, generated: { text: cleaned || text } });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('GEMINI_API_KEY')) {
        return NextResponse.json({ error: 'LLM not configured (GEMINI_API_KEY)' }, { status: 503 });
      }
      console.error('[content/generate] blog_format error:', e);
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  try {
    const source = await loadReportSourceData(runId);

    // 환자 불일치 가드 — 선택한 환자(클라이언트 표시)와 runId 로 로드된 추출 환자가 다르면 차단한다.
    // (다른 차트 데이터로 리포트가 생성되는 사고 방지. 같은 run 이면 동일 컬럼이라 오탐 없음.)
    if (expectedPatientName) {
      const sourcePatient = (source.basicInfo?.patientName ?? '').trim();
      const normName = (s: string) => s.replace(/\s+/g, ' ').trim();
      const isPlaceholder = (s: string) => !s || /미상/.test(s);
      if (
        !isPlaceholder(sourcePatient) &&
        !isPlaceholder(expectedPatientName) &&
        normName(sourcePatient) !== normName(expectedPatientName)
      ) {
        // 정상이라면 선택 환자명과 추출 환자명은 같은 run·같은 컬럼이라 일치한다.
        // 다르면 = 잘못된 차트 데이터가 로드된 시스템 오류(사용자 잘못 아님) → 생성을 중단하고 재시도를 안내.
        console.error('[content/generate] PATIENT_MISMATCH (system bug — wrong run loaded)', {
          runId,
          expectedPatientName,
          sourcePatient,
        });
        return NextResponse.json(
          {
            error: `시스템 오류로 생성을 중단했습니다. 선택하신 환자는 '${expectedPatientName}'인데, 불러온 차트 데이터는 '${sourcePatient}'입니다. 페이지를 새로고침한 뒤 다시 시도해 주세요. 계속되면 알려주세요.`,
            code: 'PATIENT_MISMATCH',
          },
          { status: 409 },
        );
      }
    }

    if (contentType === HEALTH_CHECKUP) {
      const sectionRaw = typeof body.section === 'string' ? body.section.trim() : '';
      if (sectionRaw) {
        if (!isRegenerateSection(sectionRaw)) {
          return NextResponse.json({ error: `invalid section: ${sectionRaw}` }, { status: 400 });
        }
        try {
          const checkupDate = typeof body.checkupDate === 'string' ? body.checkupDate.trim() : '';
          const must = typeof body.mustInclude === 'string' ? body.mustInclude.trim().slice(0, 1000) : '';
          const prior = await getHealthCheckupGeneratedContentForRun(pool, runId);
          const priorPayload = parseHealthCheckupPayloadFromStorage(prior?.payload ?? {});
          const coverProgramFromBody = typeof body.coverProgram === 'string' ? body.coverProgram.trim() : '';
          const reportProgramForPrompt =
            coverProgramFromBody ||
            (typeof priorPayload.coverProgram === 'string' ? priorPayload.coverProgram.trim() : '') ||
            '';
          // 재생성도 첫 생성(2단계)처럼 저장된 종합소견/사후관리를 참고해 정합성을 맞춘다.
          //  · followUp 재생성: 종합소견에만 맞춘다(옛 사후관리를 그대로 재생산하지 않도록 컨텍스트에서 제외).
          //  · overall 재생성: 백본 자체라 컨텍스트 없음.
          //  · 그 외(recheck·systems·lab): 종합소견 + 사후관리 둘 다 참고.
          const priorOverall = typeof priorPayload.overallSummary === 'string' ? priorPayload.overallSummary.trim() : '';
          const priorFollowUp = typeof priorPayload.followUpCare === 'string' ? priorPayload.followUpCare.trim() : '';
          let regenContext: string | undefined;
          if (sectionRaw === 'overall') {
            regenContext = undefined;
          } else if (sectionRaw === 'followUp') {
            regenContext = priorOverall ? `종합소견:\n${priorOverall}` : undefined;
          } else {
            const parts: string[] = [];
            if (priorOverall) parts.push(`종합소견:\n${priorOverall}`);
            if (priorFollowUp) parts.push(`사후관리:\n${priorFollowUp}`);
            regenContext = parts.length ? parts.join('\n\n') : undefined;
          }
          const partial = await generateHealthCheckupSection(
            sectionRaw,
            source,
            {
              reportProgramName: reportProgramForPrompt || undefined,
              checkupDate: checkupDate || undefined,
              mustInclude: must || undefined,
              usageContext: usageCtx('health_checkup'),
            },
            regenContext,
          );

          // 이미지 페이지(치과·피부 / 방사선·초음파)는 텍스트만 재생성하면 이미지 슬롯이 빈
          // 데모 블록으로 덮인다. 현재 run 의 케이스 이미지(나중에 추가된 것 포함)를 다시 배치한다.
          if (sectionRaw === 'systems4' || sectionRaw === 'systems5') {
            const blocksKey = sectionRaw === 'systems4' ? 'systemsPage4Blocks' : 'systemsPage5Blocks';
            const partialRecord = partial as Record<string, unknown>;
            try {
              partialRecord[blocksKey] = await applyImagePlacementForSection(
                pool,
                runId,
                sectionRaw,
                partialRecord[blocksKey],
                usageCtx('image_placement'),
                typeof priorPayload.overallSummary === 'string' ? priorPayload.overallSummary : '',
              );
            } catch (placementErr) {
              console.error('[content/generate] section image placement failed (non-blocking):', placementErr);
            }
          }

          await chargeOperationTokens(hospitalId, operationId, 'health_checkup');
          return NextResponse.json({ runId, contentType, section: sectionRaw, generated: partial, saved: false });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes('GEMINI_API_KEY')) {
            return NextResponse.json({ error: 'LLM not configured (GEMINI_API_KEY)' }, { status: 503 });
          }
          console.error('[content/generate] section regen error:', e);
          return NextResponse.json({ error: msg }, { status: 500 });
        }
      }

      try {
        const prior = await getHealthCheckupGeneratedContentForRun(pool, runId);
        const priorPayload = parseHealthCheckupPayloadFromStorage(prior?.payload ?? {});
        const coverProgramFromBody =
          typeof body.coverProgram === 'string' ? body.coverProgram.trim() : '';
        const reportProgramForPrompt =
          coverProgramFromBody || (typeof priorPayload.coverProgram === 'string' ? priorPayload.coverProgram.trim() : '') || '';
        const checkupDate = typeof body.checkupDate === 'string' ? body.checkupDate.trim() : '';
        const veterinarian = typeof body.veterinarian === 'string' ? body.veterinarian.trim() : '';
        const must =
          typeof body.mustInclude === 'string' ? body.mustInclude.trim().slice(0, 1000) : '';
        const generated = await generateHealthCheckupContent(source, {
          reportProgramName: reportProgramForPrompt || undefined,
          checkupDate: checkupDate || undefined,
          veterinarian: veterinarian || undefined,
          mustInclude: must || undefined,
          usageContext: usageCtx('health_checkup'),
        });

        /** 표지 merge 순서(vet-report POST /api/content/generate 와 동일 개념): generated → 이전 저장(키별 undefined 아닌 값만) → 요청 checkupDate/veterinarian 덮어쓰기 → 요청 coverProgram 비어 있지 않으면 표지 프로그램 덮어쓰기 → applyHealthCheckupCoverFromSource 로 DB 기본값은 null/undefined 만 채움. */
        const coverPreserve: Partial<HealthCheckupGeneratedContent> = {};
        for (const key of HEALTH_CHECKUP_COVER_STORAGE_KEYS) {
          const v = priorPayload[key];
          if (v !== undefined) coverPreserve[key] = v;
        }

        const merged: HealthCheckupGeneratedContent = {
          ...generated,
          ...coverPreserve,
          ...(checkupDate ? { coverCheckupDate: checkupDate } : {}),
          ...(veterinarian ? { coverVeterinarian: veterinarian } : {}),
        };
        if (coverProgramFromBody) merged.coverProgram = coverProgramFromBody;

        const withSourceCover = applyHealthCheckupCoverFromSource(merged, source);
        const payload = parseHealthCheckupPayloadFromStorage(withSourceCover);
        const validated = validateHealthCheckupGeneratedContent(payload, { runId });
        if (!validated.ok) {
          console.warn('[POST /api/content/generate] validation failed', {
            runId,
            error: validated.error,
            coverSnapshot: HEALTH_CHECKUP_COVER_STORAGE_KEYS.map((k) => [
              k,
              typeof (payload as Record<string, unknown>)[k],
            ]),
          });
          return NextResponse.json({ error: validated.error }, { status: 422 });
        }
        try {
          await runImagePlacementForRun(pool, runId, validated.value, usageCtx('image_placement'));
        } catch (placementErr) {
          console.error('[content/generate] image placement failed (non-blocking):', placementErr);
        }

        const parserDebug: GenerateDebugInfo['parser'] = {
          rawLength: JSON.stringify(source).length,
          repaired: false,
        };
        const saved = await upsertGeneratedRunContent(pool, runId, HEALTH_CHECKUP, validated.value);
        // 리포트가 생기는 즉시 외부 검토 링크를 보장한다 — admin 워크스페이스를 열지 않아도
        // hospital-ui 에 '리포트 확인' 버튼이 바로 뜨도록. (이미 있으면 만료 7일 연장·링크 유지)
        try {
          await ensureHealthCheckupReviewShareLink(pool, runId, getReportPublicBase());
        } catch (linkErr) {
          console.error('[content/generate] ensure review-share link failed (non-blocking):', linkErr);
        }
        await chargeOperationTokens(hospitalId, operationId, 'health_checkup');
        const debug: GenerateDebugInfo | undefined = debugEnabled
          ? {
              enabled: true,
              parser: parserDebug,
              model: { maxOutputTokens },
            }
          : undefined;
        return NextResponse.json({
          runId,
          contentType,
          generated: validated.value,
          source,
          resultCode: 'OK',
          saved,
          ...(debug ? { debug } : {}),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('GEMINI_API_KEY')) {
          return NextResponse.json({ error: 'LLM not configured (GEMINI_API_KEY)' }, { status: 503 });
        }
        throw e;
      }
    }

    // ── 진료케이스 블로그 3단계 (docs/case-blog) ─────────────────────────────
    // 케이스 개요(hospital-ui blog_case) 로드 — 전체 항목(빈 값 포함) + 프롬프트용 텍스트.
    const loadCaseOverviewForRun = async () => {
      const blogCase = await getGeneratedByType(pool, runId, 'blog_case');
      const rawOverview =
        (blogCase?.payload as { overview?: Record<string, unknown> } | null)?.overview ?? {};
      const ro = rawOverview as Record<string, unknown>;
      const caseOverview = OVERVIEW_LABELS.map(({ key, label }) => {
        let raw = ro[key];
        // 구 데이터 호환: 주질환명이 비어 있으면 예전 final_diagnosis 를 주질환명으로 사용.
        if (key === 'main_disease' && !String(raw ?? '').trim()) raw = ro.final_diagnosis;
        return { label, value: String(raw ?? '').trim() };
      });
      const filled = caseOverview.filter((x) => x.value);
      const caseOverviewText = filled.length
        ? filled.map((x) => `- ${x.label}: ${x.value}`).join('\n')
        : '(작성된 케이스 개요 없음)';
      return { caseOverview, caseOverviewText };
    };

    // 1단계 — 인과 흐름(causalFlow). thinking 켬, maxOutputTokens 넉넉히. 저장 안 함(모달에서 검수).
    if (contentType === BLOG_CAUSAL) {
      try {
        const { caseOverview, caseOverviewText } = await loadCaseOverviewForRun();
        const sourceText = JSON.stringify(source).slice(0, 120_000);
        const userContent = [
          'CASE_OVERVIEW:',
          caseOverviewText,
          '',
          'CHART_SOURCE:',
          sourceText,
          '',
          '---',
          '위 자료로 인과 흐름을 재구성하여, 지정된 JSON 형식으로만 출력하세요.',
        ].join('\n');
        const stageMaxTokens = 16384;
        const raw = await geminiGenerateText(userContent, {
          systemInstruction: SYS_CAUSAL,
          thinkingBudget: 4096,
          maxOutputTokens: stageMaxTokens,
          usageContext: usageCtx('blog_causal'),
        });
        const { parsed: causalFlow, debug: parserDebug } = await parseJsonWithRepair(
          raw,
          'object with keys: axis (string), anesthesia (boolean), phases (array of {id,name,period, actions:array of {what:string, why:string, result:string, types:string[], detail:string}, nextStep:string[]})',
        );
        const debug: GenerateDebugInfo | undefined = debugEnabled
          ? { enabled: true, parser: parserDebug, model: { maxOutputTokens: stageMaxTokens } }
          : undefined;
        await chargeOperationTokens(hospitalId, operationId, 'blog_causal');
        return NextResponse.json({
          runId,
          contentType,
          generated: { causalFlow, caseOverview },
          payload: { causalFlow, caseOverview },
          saved: false,
          ...(debug ? { debug } : {}),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('GEMINI_API_KEY')) {
          return NextResponse.json({ error: 'LLM not configured (GEMINI_API_KEY)' }, { status: 503 });
        }
        throw e;
      }
    }

    // 1단계 — 특정 날짜(phase) 하나만 다시 생성. 입력=현재 causalFlow + 대상 index + feedback + 차트/개요.
    if (contentType === BLOG_CAUSAL_PHASE) {
      try {
        const causal = (body.causalFlow ?? {}) as { phases?: unknown[] };
        const phases = Array.isArray(causal.phases) ? causal.phases : [];
        const idx = Number(body.phaseIndex);
        if (!Number.isInteger(idx) || idx < 0 || idx >= phases.length) {
          return NextResponse.json({ error: 'valid phaseIndex is required for blog_causal_phase' }, { status: 400 });
        }
        const feedback = String(body.feedback ?? '').trim();
        const { caseOverviewText } = await loadCaseOverviewForRun();
        const sourceText = JSON.stringify(source).slice(0, 120_000);
        const userContent = [
          'CASE_OVERVIEW:', caseOverviewText, '',
          'FULL_FLOW (전체 맥락 — 이 중 대상 날짜 하나만 수정):',
          JSON.stringify(causal).slice(0, 40_000), '',
          'TARGET_PHASE (다시 작성할 날짜):',
          JSON.stringify(phases[idx]).slice(0, 8_000), '',
          'FEEDBACK (수정 요청):',
          feedback || '(요청 없음 — 품질 개선 목적으로 다시 정리)', '',
          'CHART_SOURCE:', sourceText, '',
          '---',
          '위 자료로 TARGET_PHASE 하나만 다시 작성해, 지정된 JSON(phase 객체 하나)만 출력하세요.',
        ].join('\n');
        const stageMaxTokens = 8192;
        const raw = await geminiGenerateText(userContent, {
          systemInstruction: SYS_CAUSAL_PHASE,
          thinkingBudget: 2048,
          maxOutputTokens: stageMaxTokens,
          usageContext: usageCtx('blog_causal'),
        });
        const { parsed: phase, debug: parserDebug } = await parseJsonWithRepair(
          raw,
          'object with keys: id (string), name (string), period (string), actions (array of {what:string, why:string, result:string, types:string[], detail:string}), nextStep (string[])',
        );
        const debug: GenerateDebugInfo | undefined = debugEnabled
          ? { enabled: true, parser: parserDebug, model: { maxOutputTokens: stageMaxTokens } }
          : undefined;
        await chargeOperationTokens(hospitalId, operationId, 'blog_causal');
        return NextResponse.json({
          runId,
          contentType,
          generated: { phase },
          saved: false,
          ...(debug ? { debug } : {}),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('GEMINI_API_KEY')) {
          return NextResponse.json({ error: 'LLM not configured (GEMINI_API_KEY)' }, { status: 503 });
        }
        throw e;
      }
    }

    // 2단계 — 진단·치료 세부 흐름(detailFlow). 입력=검수된 causalFlow + 차트 + 개요. thinking 켬. 저장은 모달이.
    if (contentType === BLOG_DETAIL) {
      try {
        const causalFlowJson = body.causalFlow != null ? JSON.stringify(body.causalFlow).slice(0, 40_000) : '';
        if (!causalFlowJson) {
          return NextResponse.json({ error: 'causalFlow is required for blog_detail' }, { status: 400 });
        }
        const { caseOverview, caseOverviewText } = await loadCaseOverviewForRun();
        const sourceText = JSON.stringify(source).slice(0, 120_000);
        const userContent = [
          'CAUSAL_FLOW (1단계 검수 결과):',
          causalFlowJson,
          '',
          'CASE_OVERVIEW:',
          caseOverviewText,
          '',
          'CHART_SOURCE:',
          sourceText,
          '',
          '---',
          '위 자료에서 진단 과정과 치료 과정을 표준 임상 순서의 세부 단계로 전개하여, 지정된 JSON 형식으로만 출력하세요.',
        ].join('\n');
        const stageMaxTokens = 16384;
        const raw = await geminiGenerateText(userContent, {
          systemInstruction: SYS_DETAIL,
          thinkingBudget: 4096,
          maxOutputTokens: stageMaxTokens,
          usageContext: usageCtx('blog_detail'),
        });
        const { parsed: detailFlow, debug: parserDebug } = await parseJsonWithRepair(
          raw,
          'object with keys: diagnosis {steps:[{name,why,what,result,fromChart}]}, treatment {type, procedures:[{name, steps:[{step,why,detail,fromChart}]}]}',
        );
        const debug: GenerateDebugInfo | undefined = debugEnabled
          ? { enabled: true, parser: parserDebug, model: { maxOutputTokens: stageMaxTokens } }
          : undefined;
        await chargeOperationTokens(hospitalId, operationId, 'blog_detail');
        return NextResponse.json({
          runId,
          contentType,
          generated: { detailFlow, caseOverview },
          payload: { detailFlow, caseOverview },
          saved: false,
          ...(debug ? { debug } : {}),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('GEMINI_API_KEY')) {
          return NextResponse.json({ error: 'LLM not configured (GEMINI_API_KEY)' }, { status: 503 });
        }
        throw e;
      }
    }

    // 3단계 — 섹션 아웃라인(outline). 입력=검수된 causalFlow + detailFlow. thinking 0. 저장 안 함.
    if (contentType === BLOG_OUTLINE) {
      try {
        const causalFlowJson = body.causalFlow != null ? JSON.stringify(body.causalFlow).slice(0, 40_000) : '';
        if (!causalFlowJson) {
          return NextResponse.json({ error: 'causalFlow is required for blog_outline' }, { status: 400 });
        }
        const detailFlowJson = body.detailFlow != null ? JSON.stringify(body.detailFlow).slice(0, 40_000) : '';
        const { caseOverview, caseOverviewText } = await loadCaseOverviewForRun();
        const sourceText = JSON.stringify(source).slice(0, 120_000);
        // 이미지 배정은 블로그 글 확정 후 4단계(blog_images)에서 별도 비전 분석으로 한다.
        // 여기서는 텍스트 아웃라인만 만든다(imageFileNames 는 빈 배열로 둔다).
        const userContent = [
          'CAUSAL_FLOW (1단계 검수 결과 — 전체 흐름):',
          causalFlowJson,
          '',
          'DETAIL_FLOW (2단계 검수 결과 — 진단·치료 세부 단계):',
          detailFlowJson || '(없음 — 진단·치료 섹션은 CAUSAL_FLOW 기준으로 배치)',
          '',
          'CASE_OVERVIEW:',
          caseOverviewText,
          '',
          'CHART_SOURCE:',
          sourceText,
          '',
          '---',
          '위 인과 흐름과 진단·치료 세부 단계를 섹션 아웃라인으로 배치하여, 지정된 JSON 형식으로만 출력하세요.',
          '진단 과정·치료 과정 섹션의 facts 에는 DETAIL_FLOW 의 step 들을 순서 그대로 빠짐없이 반영하세요.',
          '각 섹션의 imageFileNames 는 빈 배열([])로 두세요. (이미지는 이후 단계에서 따로 배정합니다.)',
          '마지막에 overviewCheck로 CASE_OVERVIEW 누락 여부를 점검하세요.',
        ].join('\n');
        const stageMaxTokens = 8192;
        const raw = await geminiGenerateText(userContent, {
          systemInstruction: SYS_OUTLINE,
          thinkingBudget: 0,
          maxOutputTokens: stageMaxTokens,
          usageContext: usageCtx('blog_outline'),
        });
        const { parsed: outline, debug: parserDebug } = await parseJsonWithRepair(
          raw,
          'object with keys: title_candidates (string[]), sections (array of {id,label,points,facts}), overviewCheck (array)',
        );
        const debug: GenerateDebugInfo | undefined = debugEnabled
          ? { enabled: true, parser: parserDebug, model: { maxOutputTokens: stageMaxTokens } }
          : undefined;
        await chargeOperationTokens(hospitalId, operationId, 'blog_outline');
        return NextResponse.json({
          runId,
          contentType,
          generated: { outline, caseOverview },
          payload: { outline, caseOverview },
          saved: false,
          ...(debug ? { debug } : {}),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('GEMINI_API_KEY')) {
          return NextResponse.json({ error: 'LLM not configured (GEMINI_API_KEY)' }, { status: 503 });
        }
        throw e;
      }
    }

    // 4단계 — 블로그 글(blogPost). 입력=검수된 outline + 병원명/환자명 + 좋은예시(선택). thinking 0. 저장.
    if (contentType === BLOG_POST) {
      try {
        const outlineJson = body.outline != null ? JSON.stringify(body.outline).slice(0, 60_000) : '';
        if (!outlineJson) {
          return NextResponse.json({ error: 'outline is required for blog_post' }, { status: 400 });
        }
        const { caseOverview, caseOverviewText } = await loadCaseOverviewForRun();
        const goodExampleInput = typeof body.goodExample === 'string' ? body.goodExample.trim() : '';
        const goodExample = (goodExampleInput || GOOD_EXAMPLE_DEFAULT).slice(0, 20_000);
        const hospitalName = (source.basicInfo?.hospitalName ?? '').trim();
        const patientName = (source.basicInfo?.patientName ?? '').trim();
        // 인트로 "어디에 위치한" 용 지역 — core.hospitals.address 앞부분(시도+시군구). 없으면 빈값.
        let hospitalRegion = '';
        try {
          const { rows: prRows } = await pool.query<{ hospital_id: string | null }>(
            `SELECT hospital_id FROM chart_pdf.parse_runs WHERE id = $1::uuid LIMIT 1`,
            [runId],
          );
          const hid = prRows[0]?.hospital_id;
          if (hid) {
            const { rows: hRows } = await pool.query<{ address: string | null }>(
              `SELECT address FROM core.hospitals WHERE id::text = $1 LIMIT 1`,
              [String(hid)],
            );
            const addr = (hRows[0]?.address ?? '').trim();
            if (addr) hospitalRegion = addr.split(/\s+/).slice(0, 2).join(' ');
          }
        } catch {
          /* 지역 조회 실패 시 위치 생략 */
        }
        const userContent = [
          `병원정보: 병원명 ${hospitalName || '(미상)'} / 병원위치 ${hospitalRegion || '(미상)'} / 환자명 ${patientName || '(미상)'}`,
          '',
          'OUTLINE (3단계 검수 결과):',
          outlineJson,
          '',
          'CASE_OVERVIEW:',
          caseOverviewText,
          goodExample ? `\n<좋은예시>\n${goodExample}\n</좋은예시>` : '',
          '',
          '---',
          '위 아웃라인으로 블로그 글을 완성하여, 지정된 JSON 형식으로만 출력하세요.',
        ].join('\n');
        const stageMaxTokens = 12288;
        const raw = await geminiGenerateText(userContent, {
          systemInstruction: SYS_BLOGPOST,
          thinkingBudget: 0,
          maxOutputTokens: stageMaxTokens,
          usageContext: usageCtx('blog_post'),
        });
        const { parsed: generated, debug: parserDebug } = await parseJsonWithRepair(
          raw,
          'object with keys: title (string), bodyMarkdown (string), tags (string[]), charCount (number)',
        );
        const saved = await upsertGeneratedRunContent(pool, runId, BLOG_POST, generated);
        await chargeOperationTokens(hospitalId, operationId, 'blog_post');
        const debug: GenerateDebugInfo | undefined = debugEnabled
          ? { enabled: true, parser: parserDebug, model: { maxOutputTokens: stageMaxTokens } }
          : undefined;
        return NextResponse.json({
          runId,
          contentType,
          generated,
          payload: generated,
          caseOverview,
          saved,
          ...(debug ? { debug } : {}),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('GEMINI_API_KEY')) {
          return NextResponse.json({ error: 'LLM not configured (GEMINI_API_KEY)' }, { status: 503 });
        }
        throw e;
      }
    }

    return NextResponse.json({ error: `unsupported contentType: ${contentType}` }, { status: 400 });
  } catch (e) {
    console.error('POST /api/content/generate:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
