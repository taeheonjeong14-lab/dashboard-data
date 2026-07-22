# 진료케이스 2단계 아웃라인 재설계 — 핸드오프

작성: 2026-07-06. 상태: **구현 완료(A·B·C 전부).** 검증: admin-web `tsc` ✓ / chart-api `tsc` + `npm run build` ✓. 남은 것: admin에서 실제 케이스로 1→2단계 생성해 섹션이 태그별로 묶이는지 최종 확인(수동).

## 배경 (오늘까지의 흐름)
- 진료케이스 블로그 파이프라인을 4단계로 축소함: **1 인과 흐름 → 2 아웃라인 → 3 블로그 글 → 4 이미지** (기존 "진단·치료 세부" 2단계 제거). 관련 메모리 [[project_case_blog_pipeline]].
- 1단계(인과 흐름)에서 각 **행위 카드(action)** 에 성격 **해시태그(types)** 를 붙임. 태그 10종(키=라벨):
  `exam_dx=검사 및 진단`, `preop=술 전 검사`, `surgical=수술`, `postop_recovery=술 후 회복`,
  `postop_followup=술 후 경과확인`, `medical=내과 치료`, `admission=입원 치료`, `discharge=퇴원`,
  `aftercare=사후관리 안내`, `other=기타`. (순서 = `ACTION_TYPE_ORDER` in `apps/admin-web/components/admin-case-blog-modal.tsx`)
- 카드 데이터: `Action = { what, why, result, types[], detail, procedure[] }`. `#수술`은 procedure(단계별 시술 절차 [{step,note}]), `#내과 치료`는 detail(약 종류).

## 재설계 목표 (사용자 확정)
2단계 아웃라인을 **"해시태그 = 섹션"** 구조로 바꾼다.

1. **해시태그 섹션**: 각 태그를 섹션으로 간주. 그 태그가 붙은 **카드들을 모아서 보여주고**, AI가 그 섹션의 **핵심 요약**을 씀.
   - 예: `#수술` 섹션 = surgical 태그가 붙은 카드들 + 그 섹션 핵심요약.
2. **고정 서술 섹션**(해시태그 없음): **인트로 / 질환 소개 / 내원 배경 / 원장님 한마디 / 아웃트로**.
   - 할당되는 카드가 없으니 AI가 **핵심 요약만** 씀(카드 그룹 없음).
3. **섹션 순서**: 인트로 → 질환 소개 → 내원 배경 → [진료 흐름 순서(ACTION_TYPE_ORDER)대로 **존재하는** 해시태그 섹션들] → 원장님 한마디 → 아웃트로.
   - 해시태그 섹션은 causalFlow 안에 그 태그를 가진 카드가 하나라도 있을 때만 포함.
4. 이 섹션별 **핵심 요약 + facts**가 3단계 블로그 글 작성의 입력이 됨.

### 확정된 설계 결정
- **다중 태그 카드**: 카드에 태그가 2개 이상이면(예 [수술,입원]) **해당 모든 섹션에 다 등장**(중복 허용). 각 섹션 요약은 그 관점에서 그 카드를 다룸.
- **섹션 내용**: **핵심 요약 + 구체 데이터(facts) 분리 유지**. 즉 기존 `points`(서술 방향/핵심요약) + `facts`(반드시 들어갈 수치·검사값·소견) 구조 계승. UI 라벨은 "핵심 요약"으로.

## 구현 계획 (건드릴 곳)

### A. 모달 `apps/admin-web/components/admin-case-blog-modal.tsx`
1. **타입**: `Section` 에 `tag: string` 추가. 해시태그 섹션이면 ACTION_TYPE 키(exam_dx 등), 고정 서술 섹션이면 `''`.
2. **asOutline**: 섹션 파싱에 `tag: str(x.tag)` 추가.
3. **addSection** 기본값: `tag: ''`.
4. **OutlineEditor**:
   - `causal: CausalFlow | null` prop 추가(호출부 line ~714에서 `causal` 넘기기 — 컴포넌트 스코프에 이미 `causal` state 있음).
   - 각 섹션에 `tag` 있으면: 태그 칩 + **그 태그가 붙은 카드들(causal.phases[].actions[] 중 action.types.includes(section.tag))을 읽기 전용으로 그룹 표시**(what/목적/결과, 있으면 procedure/detail 요약).
   - `points` 라벨을 "핵심 요약"으로. `facts` 유지.
   - 고정 섹션(tag '')은 카드 그룹 없이 요약+facts만.
5. Step4Editor/BlogEditor 는 points/facts/imageFileNames 그대로 쓰므로 큰 변경 없음(라벨 정도).

### B. chart-api `chart-api/app/api/content/generate/route.ts` — `SYS_OUTLINE`
- 입력은 이미 causalFlow(전 필드). 프롬프트를 **해시태그 섹션 + 고정 섹션** 생성으로 재작성:
  - 항상 포함: 인트로/질환소개/내원배경(앞), 원장님한마디/아웃트로(뒤) — tag="".
  - causalFlow action 들의 types 를 모아, 존재하는 태그마다 섹션 1개(tag=그 키), ACTION_TYPE_ORDER 순서로 내원배경과 원장님한마디 사이에 배치.
  - 각 섹션: `label`(태그 라벨 또는 고정 섹션명), `tag`(키 또는 ""), `points`(핵심요약 불릿), `facts`(그 섹션 카드들의 수치·검사값·소견; 수술 섹션은 procedure 단계, 내과는 detail 약 종류 반영).
  - 기존 규칙 중 살릴 것: 내원배경=진료 전 보호자 진술만/원장님한마디=일반 교훈/질환소개=주질환 일반의학정보+창작금지/facts 선별(핵심 뒷받침 수치만)/이미지 imageFileNames=[]/마취 안전성/중복 금지/날짜-사실 정합성.
- JSON 스키마에 `tag` 필드 추가. parseJsonWithRepair 힌트도.

### C. chart-api `SYS_BLOGPOST` (3단계 블로그 글)
- points/facts 계승이라 **동작은 유지**되지만, 섹션 라벨이 진단과정/치료과정 → 해시태그명(검사및진단·수술·술후회복 등)으로 바뀜.
- 섹션 라벨별 특수 규칙(진단 과정·치료 과정 세분·사후관리)을 **해시태그 기준으로 remap** 필요. 최소한 "섹션이 해시태그 기반"임을 알리고, 수술 섹션 procedure 를 술기 흐름으로 풀어쓰라는 지시 유지.

## 검증
- 파서/프롬프트 아닌 UI·타입은 `apps/admin-web`에서 `npx tsc --noEmit`.
- chart-api 프롬프트/스키마는 `npx tsc --noEmit` + `npm run build`(중요, [[project_chart_api_build_gotchas]]).
- 최종은 admin에서 실제 케이스로 1단계 검수 → 2단계 아웃라인 생성해 섹션이 태그별로 묶이는지 확인.

## 커밋 지침
- 자동 커밋·푸시 금지. 항상 사용자에게 먼저 물어보고 진행([[feedback_commit_push]]).
- 커밋 메시지 Co-Authored-By 라인 포함.

## 참고
- 오늘 완료된 관련 커밋: case-blog 2단계 제거·detail/procedure·해시태그, 그리고 별개로 검사결과 파싱 대량 수정(요검사·Osmolality·nom/음성·MCV 병합 등). main 최신 `d855f41`.
