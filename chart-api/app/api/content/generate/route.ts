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
import { getChartPgPool } from '@/lib/db';
import { applyHealthCheckupCoverFromSource } from '@/lib/chart-app/health-checkup-cover-from-source';
import { loadReportSourceData } from '@/lib/chart-app/report-source';

const HEALTH_CHECKUP = 'health_checkup';
const BLOG_POST = 'blog_post';
const BLOG_CAUSAL = 'blog_causal';
const BLOG_OUTLINE = 'blog_outline';

// 진료케이스 케이스 개요(hospital-ui blog_case) 라벨
const OVERVIEW_LABELS: { key: string; label: string }[] = [
  { key: 'final_diagnosis', label: '최종 진단명' },
  { key: 'visit_background', label: '내원 배경' },
  { key: 'patient_notes', label: '환자 특이사항' },
  { key: 'diagnosis_method', label: '진단 방식' },
  { key: 'treatment_process', label: '치료 과정' },
  { key: 'aftercare_plan', label: '사후 관리 계획' },
  { key: 'emphasis', label: '강조 희망 사항' },
];

// ── 진료케이스 블로그 3단계 systemInstruction (docs/case-blog 기준) ──────────
const SYS_CAUSAL = `당신은 동물병원을 운영하는 수의사이자 병원 원장입니다.
지금은 진료 사례 블로그 글 작성의 [1단계 — 인과 흐름 재구성]입니다.
섹션 배치 전에, 무슨 일이 왜 그 순서로 일어났는지 임상 인과를 복원합니다.

# 반드시 지킬 것
- 제공된 입력(CHART_SOURCE, CASE_OVERVIEW)에 있는 내용만 사용한다.
  (처치를 잇는 "왜"의 일반 임상 원리 설명은 예외로 허용. 환자 고유 사실—
   증상·수치·결과—은 입력에 있을 때만 쓴다.)
- "고려됨"으로만 적힌 검사·처치는 시행한 것으로 쓰지 않는다.
- 약어는 약어사전으로 해석하고, 모르는 약어는 추측 말고 생략한다.
- 반드시 한국어로 작성한다. (코드/JSON 키는 영어 유지)

# 흐름의 축
- CASE_OVERVIEW의 최종 진단명·강조 희망사항을 흐름의 축으로 삼는다.
  (같은 차트라도 강조점에 따라 흐름의 중심이 달라진다)

# 인과 재구성 규칙
1. 날짜를 임상 단계로 묶고 각 단계에 이름을 붙인다.
   연속된 같은 문제의 진료는 하나의 단계로 묶는다.
2. 단계 사이를 "왜 다음 단계로 넘어갔는지"로 잇는다.
3. 한 단계 안에 처치가 여럿이면, 앞 처치가 다음 처치를 부른 이유로 엮는다.
4. 처치를 잇는 "왜"는 차트에 없어도 일반 임상 원리로 채운다.
5. 반복 복사된 항목(사료/유치교체 등)은 변화 없으면 제외한다.

# 선행/보조 치료는 별도 단계로 — 중요
- 핵심 처치(예: 수술)를 "가능하게 하기 위해" 먼저 시행한 선행 치료·안정화가 있으면,
  그것을 검사 단계나 핵심 치료 단계에 섞지 말고 "독립된 치료 단계"로 분리한다.
  · 예: 방광결석 제거 수술이 필요하나 간수치가 높아, 먼저 간수치 안정화 치료를 한 뒤 수술한 경우
    → "간수치 안정화 치료" 단계와 "방광결석 제거 수술" 단계를 각각 별도 단계로 나눈다.
- 분리 기준: 그 치료가 (1) 핵심 처치를 위해 선행돼야 했고, (2) 일정 기간에 걸쳐 진행되거나
  그 자체로 임상적 의미(상태 호전·수술 가능 조건 충족)를 가지면 → 독립 단계.
- 단순 검사·수치 확인만으로 끝난 것은 "치료"가 아니므로 분리 대상이 아니다(검사 단계 유지).
  실제 처치·투약 등 "치료"가 선행된 경우에만 분리한다.
- 핵심 치료가 하나뿐이어도, 그를 위한 또 다른 치료가 있었다면 의미 있는 별도 단계로 인지한다.
  (이렇게 해야 2단계 아웃라인에서 '치료 과정'이 여러 섹션으로 분할될 수 있다.)

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
- 날짜-사실 정합성(매우 중요, 신뢰도 직결): 각 단계의 what/why/toNext에 넣는 검사·수치·소견·처치는
  그 단계의 period(날짜)에 자료상 실제로 기록된 것만 넣는다. 다른 날짜에 한 검사·수치를 이 단계로 끌어오지 말 것.
  · 어느 날짜에 한 것인지 자료(날짜별 차트/검사 기록)로 확정할 수 없는 항목은 특정 단계(날짜)에 임의로 귀속시키지 않는다.

# 치료 성격 구분
- 각 단계가 수술/처치형(surgical), 내과 치료형(medical), 검사형(diagnostic)인지 판단.
- 내과(medical) 단계는 "시점별 상태 변화"를 핵심으로.
  · 상태 변화는 차트에 수치 있으면 수치로(OO→OO), 없으면 정성적으로. (날짜는 위 period 규칙대로 정확히)

# 마취 동반 판단
- 전신마취 동반 처치가 있으면 anesthesia=true.
- 마취 동반 시, 마취 전 안전성 평가를 독립된 비중 있는 단계로 잡는다.
  (검진과 술전검사가 겹친 경우, 새 검사를 지어내지 말고 이미 한 검사의
   '마취 전 평가 의미'를 해석해 반영)

# 세 항목(what / why / toNext) 구분 — 중요
- what (무엇을 했나): 그 단계에서 시행한 검사·처치·행위 "자체"만 적는다.
  (예: "복부 초음파 시행", "혈액검사 시행", "항생제 처방", "중성화 수술 시행")
  ※ 검사 수치·진단 결과·처방 후 경과 등 "결과"는 여기에 넣지 말 것.
- why (왜 했나): 그 검사/처치를 한 임상적 이유·원리.
- toNext (결과 및 다음 단계): 그 단계의 "결과"를 먼저 적고, 그 결과에 따라 다음 단계로 무엇을 하게 되었는지 잇는다.
  · 결과 = 검사 수치·진단 결과·처방 후 변화·경과 등 차트에 있는 사실. (검사결과·처방내역의 효과는 여기에)
  · 다음 단계 = 그 결과 때문에 이어진 다음 처치/판단. (마지막 단계면 결과만 적고 다음 단계는 생략)

# 서술 형식
- what·why·toNext 는 각각 1~3개의 짧은 불릿(문자열 배열)로 작성한다.
- 각 불릿은 한 가지 사실/이유만 담아 한 줄로 간단명료하게. 긴 문단·여러 문장 나열 금지(한 불릿 = 한 줄).

# 출력 형식 — JSON only (다른 텍스트·마크다운 코드펜스 없이 JSON만)
{
  "axis": "이 케이스 흐름의 축 한 줄 요약",
  "anesthesia": true 또는 false,
  "phases": [
    {
      "id": "phase_1",
      "name": "단계명",
      "period": "0000년 00월 00일 (최초 진단일로부터 약 00일/00주 후) — 예: 2026년 02월 17일 (최초 진단일로부터 약 2주 후)",
      "type": "surgical | medical | diagnostic",
      "what": ["시행한 검사/처치/행위 자체 — 불릿 (결과·수치는 제외)", "불릿2"],
      "why": ["그 검사/처치를 한 임상적 이유 — 불릿1", "불릿2"],
      "toNext": ["결과(검사 수치·진단·경과) + 그에 따른 다음 단계 — 불릿 (마지막 단계는 결과만)"]
    }
  ]
}

# 약어사전
CC=주호소, Rx=처방, CE=진료/코멘트, OU=양쪽 눈, AD=오른쪽 귀,
bid=하루2회, sid=하루1회, tid=하루3회, cast Sx=중성화수술,
aus NRF=청진 특이소견 없음, no vdsc=구토/설사/기침 등 없음`;

const SYS_OUTLINE = `당신은 동물병원을 운영하는 수의사이자 병원 원장입니다.
지금은 [2단계 — 섹션 아웃라인 배치]입니다.
1단계에서 재구성·검수된 인과 흐름(CAUSAL_FLOW)을 받아,
정해진 섹션 구조에 배치합니다.

# 입력 우선순위
- CAUSAL_FLOW(JSON): ★ 흐름과 순서의 기준. phases 순서·인과를 따른다.
- CASE_OVERVIEW: 반드시 모두 반영할 내용.
- CHART_SOURCE: 디테일(수치·검사명) 보강용으로만. 흐름을 바꾸지 말 것.
  CAUSAL_FLOW가 뺀 곁가지를 차트에 있다는 이유로 다시 넣지 말 것.

# 반드시 지킬 것
- 없는 사실 창작 금지. CAUSAL_FLOW와 CASE_OVERVIEW 내용 위주로.
- CAUSAL_FLOW의 인과 순서를 무너뜨리지 말 것.
- CASE_OVERVIEW의 모든 항목을 어느 섹션엔가 반드시 반영.
- 한국어. (JSON 키는 영어)

# 섹션 구조 (기본 8개, label로 표기)
인트로 / 질환 소개 / 내원 배경 / 진단 과정 / 치료 과정 /
사후 관리방안 / 원장님 한마디 / 아웃트로

# '원장님 한마디' 섹션 목적 (혼동 주의)
- 이 케이스 내용을 다시 자세히 늘어놓는 곳이 아니다. 이 사례를 통해 "불특정 다수의 반려동물 보호자"가
  알면 좋을 교육적 메시지·당부를 함축해 전하는 섹션이다.
  · 예) 조기 발견의 중요성, 비슷한 증상이 보이면 빨리 내원하라는 권유, 평소 관리·예방 팁, 정기검진 권유 등
    이 사례에서 끌어낸 일반화된 교훈.
  · 환자 고유의 수치·검사 재나열 금지. 따뜻하고 신뢰감 있는 원장의 당부 톤으로.

# '사후 관리방안' 섹션 목적·어조
- 병원 치료가 어느 정도 마무리되는 시점에, 재발 방지 및 악화 가속을 막기 위해 원장이 보호자에게
  알려주고 당부한 "집에서의 관리법"을 전하는 섹션이다.
- 어조: "보호자에게 무엇을 전달·당부했는지"가 드러나게 쓴다.
  · 예) "보호자님께 ~에 유의해 주시도록 말씀드렸습니다", "환자가 매일 양치를 할 수 있도록 당부드렸습니다",
    "~한 증상이 다시 보이면 바로 내원해 주시길 안내드렸습니다."

# 치료 과정 유연 분할
- CAUSAL_FLOW의 치료 단계가 많거나 국면이 뚜렷이 다르면 '치료 과정'을
  여러 섹션으로 (label: "치료 과정 ①", "치료 과정 ②"). 최대 3개.
- 핵심 치료를 위한 선행/보조 치료(예: 수술 전 간수치 안정화)가 CAUSAL_FLOW에서 별도 치료 단계로 있으면,
  그 선행 치료와 핵심 치료를 각각 별도 '치료 과정' 섹션으로 둔다.
- 국면 전환 시에만 나눔. 세부 행위(채혈·절개·봉합)로는 나누지 않음.

# 배치 규칙
- 각 섹션은 points(요점)와 facts(팩트)로 나눈다. 각각 불릿 배열.
  · points: 무엇을 어떤 방향으로 다룰지 (서술 방향)
  · facts: 글에 반드시 들어갈 구체 데이터
- facts 두 종류 구분:
  ① 검사·진단 → 구체적으로. 검사 수치(예: SDMA 11), 검사명(예: 복부 초음파),
     진단명, 경과 시점. 혈액검사 등 정상범위가 자료에 있으면 그 정상범위도 fact에 함께 담는다(예: "CRP 9.6 (정상 1 이하)").
  ② 처치·약물·수술 술기 → 일반어로. 약물명·성분·도구·규격은 쓰지 않음.
     (단 처치의 "흐름과 이유"는 살린다)
- 수치 단위는 차트에 명시된 것만. 없으면 단위 없이 수치만. (VHS 등 무단위 지표는 단위 없음)
- 날짜-사실 정합성(매우 중요): 섹션이 특정 phase(시점)를 다루면 그 phase의 period(날짜)를 섹션 "period"에 그대로 옮긴다.
  · 그 섹션 facts의 검사·수치·소견·처치는 그 phase에 속한 것만 담는다. 다른 phase/날짜의 사실을 끌어와 섞지 말 것.
  · 한 검사·수치는 그것이 실제 시행된 phase의 섹션에만 둔다(시점 이동·복제 금지).
- 질환 소개 섹션에 한해 일반 의학정보 작성 허용(일반 원리만, 환자 사실 창작 금지).
  이 섹션의 points/facts에는 아래 4가지를 항상 모두 담는다:
  1) 이 질환이 어떤 질환인지 한 줄 정의.
  2) 주요 증상(보호자가 집에서 알아챌 수 있는 것 위주).
  3) 근본적인 원인.
  4) 꼭 알면 좋은 특징 — 호발 품종·연령, 악화 시 위험성, 합병증 등 해당하는 것이 있으면.

# 마취 안전성 (CAUSAL_FLOW의 anesthesia=true면)
- 진단 과정에 '마취 전 안전성 평가'를 비중 있게 배치.
- 이상 수치 + 정상·양호 수치도 facts에 포함. 단 정상 수치는 선별:
  1. 환자 위험요인(나이·기존질환)과 연결되는 항목
  2. 마취와 직접 관련된 항목(간·신장 등)
  3. 주의 수치와 대비되는 항목
  무관한 정상 수치는 넣지 않음. 차트에 실제 있는 항목만.

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
지금은 [3단계 — 블로그 글 작성]입니다.
2단계에서 완성·검수된 아웃라인(OUTLINE)을 받아 네이버 블로그 글로 완성합니다.

# 화자와 톤
- 화자: 병원이 환자의 사례를 소개하는 1인칭. 환자 이름은 병원정보의 환자명을 사용.
  예: "저희 OO동물병원에서 치료받았던 OO이의 사례를 소개합니다."
- 톤: 정보를 전달하고 설명하는 느낌. 친근하되 전문성 유지.
  이야기를 풀어놓기보다 질환과 진료 과정을 차분히 설명하는 무게로.
- <좋은예시>는 "톤앤매너(문체·어조·문장 호흡·설명 방식)만" 벤치마킹한다.
  · 예시의 사실·문장·표현을 그대로 가져오지 말 것(내용 복붙 금지).
  · 글의 내용·사실은 오직 OUTLINE·CASE_OVERVIEW·병원정보에서만 가져온다.

# 서술 관점 — 중요
- 진료 행위는 "병원(의료진) 관점의 능동태"로 쓴다. 환자가 당하는 수동 관점 금지.
  · O: "OO를 확인하기 위해 △△검사를 진행했습니다", "□□ 소견이 보여 ~ 처치를 했습니다"
  · X: "환자가 검진을 받았습니다", "OO가 검사를 받았습니다" (환자 관점 수동 서술)
- 검사·처치는 "무엇을 확인/치료하려고 했는지(목적)"를 함께 써서 능동적으로 서술한다.

# 글쓰기 규칙
- OUTLINE의 points는 서술 방향이다. 자연스러운 문장으로 풀어쓴다.
- OUTLINE의 facts는 누락·변경 없이 모두 반영하되 보호자가 이해할 말로 푼다.
  · 검사 수치·검사명은 구체적으로 살리되 쉬운 해석을 곁들인다.
    (예: "SDMA 11" → "신장 수치(SDMA)는 11로 정상 범위였습니다")
  · 처치·약물·도구 전문 명칭은 일반어로(아웃라인이 이미 일반어면 그대로).
- 진단 과정: 그 질환을 진단하기 위해 시행한 검사는 하나도 빠뜨리지 않고 모두 언급한다.
  · 각 검사는 "무엇을 확인하려 했는지(목적) + 검사명 + 결과/소견"을 함께 적어 진단 과정을 충실히 보여준다.
  · 글자수가 부족하면 다른 서술을 줄여서라도 검사 언급은 절대 생략하지 않는다(검사 누락 < 길이 초과).
- 질환 소개 섹션은 다음 4가지를 모두 담는다(자연스러운 줄글로):
  1) 이 질환이 어떤 질환인지 한 줄 정의, 2) 주요 증상, 3) 근본적인 원인,
  4) 꼭 알면 좋은 특징(호발 품종·연령, 악화 시 위험성, 합병증 등 해당 시).
- 섹션 사이를 앞이 다음을 부르는 흐름으로 잇는다.

# 일반인 눈높이 해석 — 매우 중요
- 이 글은 수의사가 아닌 보호자가 읽는다. 검사명·수치를 "팩트 나열"로 툭툭 던지지 말 것.
- 검사·수치는 항상 아래 3박자로 풀어 이야기처럼 잇는다:
  ① 왜 이 검사를 했는지(무엇을 확인하려고) → ② 어떤 결과·수치가 나왔는지 → ③ 그 수치가 무슨 의미인지(정상/주의, 환자 상태와 연결) 쉬운 말로.
  · 예) "복부 초음파로 간과 담낭 상태를 살펴보았는데요(①). 담낭벽이 평소보다 두꺼워져 있었고(②), 이는 담낭에 염증이 진행되고 있을 가능성을 의미했습니다(③)."
  · 예) "염증 수치(CRP)는 9.6이었는데요(②), 정상이 1 이하인 점을 감안하면 몸속에 상당한 염증이 있다는 신호였습니다(③)."
- 결과·수치 뒤에는 반드시 "그래서 무슨 뜻인지"가 따라오게 한다. 의미 해석 없이 숫자만 남기지 말 것.
- 검사 → 소견 → 판단 → 다음 조치로 자연스럽게 이어지는 한 편의 이야기로 쓴다(나열식 금지).

# 의학용어 — 쉽게 풀기
- 어려운 의학용어가 나오면 두 가지 중 하나로 처리한다:
  1) 한국 보호자에게 더 익숙한 일상 표현이 있으면 그 표현으로 바꾼다.
     · 예) "비후" → "두꺼워짐", "삼출물" → "진물", "예후" → "앞으로의 경과", "절제" → "잘라내는 것", "병변" → "이상이 생긴 부위"
  2) 바꿀 쉬운 말이 마땅치 않아 전문용어를 꼭 써야 하면, 처음 나올 때 괄호나 짧은 구절로 한 줄 설명을 붙인다.
     · 예) "수신증(신장에 소변이 고여 부풀어 오르는 상태)", "요관(신장에서 방광으로 소변이 내려가는 통로)"
- 같은 용어는 처음 1회만 설명한다(반복 설명 금지). 검사명 약어도 동일 원칙(예: "CRP(염증 수치)").

# 수치 표현
- 혈액검사 등 정상범위가 있는 수치는, 자료에 정상범위가 있으면 결과 수치와 함께 정상범위를 적는다.
  결과가 정상에서 얼마나 벗어났는지 보호자가 체감하게 한다. (예: "염증 수치(CRP)가 9.6으로, 정상(1 이하)을 크게 웃돌았습니다")
  · 자료에 정상범위가 없으면 지어내지 말 것(없으면 수치·의미만).
- 수치엔 단위를 붙이되 차트에 명시된 단위만. 없으면 단위 없이 수치만.
  (VHS처럼 본래 단위 없는 지표는 단위 없음)
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
  const usageCtx = (feature: string) => ({ hospitalId, feature, runId });

  try {
    const source = await loadReportSourceData(runId);

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
          const partial = await generateHealthCheckupSection(sectionRaw, source, {
            reportProgramName: reportProgramForPrompt || undefined,
            checkupDate: checkupDate || undefined,
            mustInclude: must || undefined,
            usageContext: usageCtx('health_checkup'),
          });

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
              );
            } catch (placementErr) {
              console.error('[content/generate] section image placement failed (non-blocking):', placementErr);
            }
          }

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
      const caseOverview = OVERVIEW_LABELS.map(({ key, label }) => ({
        label,
        value: String((rawOverview as Record<string, unknown>)[key] ?? '').trim(),
      }));
      const filled = caseOverview.filter((x) => x.value);
      const caseOverviewText = filled.length
        ? filled.map((x) => `- ${x.label}: ${x.value}`).join('\n')
        : '(작성된 케이스 개요 없음)';
      return { caseOverview, caseOverviewText };
    };

    // 이미 분석된 케이스 이미지(의심 질환 + 뒷받침 이미지) — 새 AI 호출 없이 저장된 결과를 텍스트로.
    const loadImageAnalysisText = async (): Promise<string> => {
      type Bullet = { text?: string; confidence?: number; fileNames?: string[]; imageConfidence?: Record<string, number> };
      const { rows } = await pool.query<{ bullets: unknown }>(
        `SELECT bullets FROM chart_pdf.parse_run_case_image_summaries WHERE parse_run_id = $1::uuid`,
        [runId],
      );
      const bullets: Bullet[] = [];
      for (const r of rows) {
        const bs = r.bullets as Bullet[] | null;
        if (Array.isArray(bs)) bullets.push(...bs);
      }
      if (bullets.length === 0) return '(분석된 이미지 없음)';
      return bullets
        .map((b) => {
          const head = `- ${String(b.text ?? '').trim()}${typeof b.confidence === 'number' ? ` (질환 confidence ${b.confidence}%)` : ''}`;
          const imgs = (Array.isArray(b.fileNames) ? b.fileNames : [])
            .map((fn) => {
              const c = b.imageConfidence?.[fn];
              return `    · ${fn}${typeof c === 'number' ? ` (이미지 confidence ${c}%)` : ''}`;
            })
            .join('\n');
          return imgs ? `${head}\n${imgs}` : head;
        })
        .join('\n');
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
          'object with keys: axis (string), anesthesia (boolean), phases (array of {id,name,period,type, what:string[], why:string[], toNext:string[]})',
        );
        const debug: GenerateDebugInfo | undefined = debugEnabled
          ? { enabled: true, parser: parserDebug, model: { maxOutputTokens: stageMaxTokens } }
          : undefined;
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

    // 2단계 — 섹션 아웃라인(outline). 입력=검수된 causalFlow. thinking 0. 저장 안 함.
    if (contentType === BLOG_OUTLINE) {
      try {
        const causalFlowJson = body.causalFlow != null ? JSON.stringify(body.causalFlow).slice(0, 40_000) : '';
        if (!causalFlowJson) {
          return NextResponse.json({ error: 'causalFlow is required for blog_outline' }, { status: 400 });
        }
        const { caseOverview, caseOverviewText } = await loadCaseOverviewForRun();
        const imageAnalysisText = await loadImageAnalysisText();
        const sourceText = JSON.stringify(source).slice(0, 120_000);
        const userContent = [
          'CAUSAL_FLOW (1단계 검수 결과):',
          causalFlowJson,
          '',
          'CASE_OVERVIEW:',
          caseOverviewText,
          '',
          'IMAGE_ANALYSIS (이미 분석된 케이스 이미지 — 의심 질환과 그 질환을 보여주는 이미지 파일명):',
          imageAnalysisText,
          '',
          'CHART_SOURCE:',
          sourceText,
          '',
          '---',
          '위 인과 흐름을 섹션 아웃라인으로 배치하여, 지정된 JSON 형식으로만 출력하세요.',
          '각 섹션의 facts와 관련된 이미지가 IMAGE_ANALYSIS에 있으면 imageFileNames에 그 파일명을 넣으세요(목록에 있는 파일명만).',
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

    // 3단계 — 블로그 글(blogPost). 입력=검수된 outline + 병원명/환자명 + 좋은예시(선택). thinking 0. 저장.
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
        const userContent = [
          `병원정보: 병원명 ${hospitalName || '(미상)'} / 환자명 ${patientName || '(미상)'}`,
          '',
          'OUTLINE (2단계 검수 결과):',
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
