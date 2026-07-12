# 블로그 글 검수 기능 — 설계 스펙 (핸드오프)

작성: 2026-07-12. 상태: **설계 확정, 구현 착수 전.** 관련 메모리: [[project_blog_content]] · [[project_case_blog_pipeline]] · [[project_tokens]] · [[project_monorepo_deploy]] · [[feedback_refund_grouping]].

## 목표
AI로 작성한(또는 외부의) 동물병원 블로그 글을 두 축으로 검수한다.
1. **의학적 정확성** — 틀렸거나 위험한 내용 탐지
2. **네이버 블로그 최적화** — 검색 노출 개선점

두 진입점:
- **A. 위저드**: 진료케이스 작성 흐름에 "글 검수" 단계 추가(이미지 단계는 뒤로 밀림).
- **B. admin 메뉴**: 우리 시스템 글 재검수 + **외부 네이버 블로그 링크** 검수(본문 가져와 검수).

---

## 아키텍처

### 검수 엔진 (내부·외부 공통, chart-api)
- 입력 표준화: `{ title, bodyText, tags[], imageCount, groundTruth? }`.
  - `groundTruth` 있음(내부) = 원본 의무기록 대조 fact-check.
  - 없음(외부) = 일반 수의학 지식 기반 검증("출처 대조 불가" 표기).
- chart-api 신규 `contentType = 'blog_review'` (기존 blog_causal/outline/post 옆). Gemini·과금이 이미 거기 있음.

### 멀티 LLM 앙상블 (Vercel AI Gateway)
- 리뷰어 3개 **병렬**: `anthropic/claude-opus-4-8`, `xai/grok-4`, `google/gemini-2.5-pro` (모델명은 착수 시 최신 확인).
- 동일 프롬프트(= 루브릭 규격) → 각자 findings JSON.
- **집계 LLM 1회** → 의미 클러스터링, `agreement: 3/3 | 2/3 | 1/3` 태깅, 중복 제거, 공통 우선 정렬.
- **비공통(1/3) findings = "참고" 섹션에 낮은 신뢰도로 분리**(버리지 않음).
- 4회 호출 모두 동일 `operationId` → usage 합산 원가 **1회 차감**.
- 연동: AI SDK v6 `generateText`. 결과 `usage`를 `recordTokenUsage`로 연결(빌링). `llm-pricing.ts`에 xai/grok 단가행 추가, claude 갱신.

### 과금 / 바른플랜 환불
- `feature='blog_review'` 로 차감 → `p_feature like 'blog%'` → `product='case_blog'` 자동 라벨 → **바른플랜이면 자동 환불(net 0). 마이그레이션 불필요**(`billing.token_charge_operation`).
- `blog_review`는 `v_is_case_write`(blog_causal/detail/outline/post) 미포함 → ×30 인건비 배율 없이 **원가만** 과금.
- 외부 검수: 실행 시 **대상 병원 선택** → 그 병원 과금(바른플랜이면 환불).

### 저장 (이원화)
- 내부(위저드): `generated_run_content(content_type='blog_review')`, runId 키.
- 외부(admin): 신규 테이블 `blog_reviews(id, source_type, source_url, input_text, report jsonb, hospital_id, created_by, created_at)`.

### 외부 네이버 링크 처리
- URL 3형식 파싱: `blog.naver.com/{id}/{logNo}`, `?blogId=&logNo=`, 모바일.
- **모바일 URL(`m.blog.naver.com/{id}/{logNo}`)** fetch → 본문 컨테이너(`.se-main-container` / 레거시 `#postViewArea`) 추출 → 텍스트·제목·이미지수.
- 서버 fetch 실패 대비 **본문 붙여넣기 폴백**.

---

## 루브릭 (10항목 = 의학 5 + SEO 5)

**단일 소스**: 모노레포 공유 패키지 `@dashboard/blog-review-rubric`에 항목·목표값·신호등 규칙 정의. chart-api 프롬프트 빌더, 결정적 지표 계산기, admin-web 결과화면·"평가 기준 보기"가 **모두 이걸 소비** → 유저가 보는 기준 = 실제 채점 기준.

### 축 1 — 의학적 정확성 (게이트 축)
| # | 항목 | 심각도 |
|---|---|---|
| M1 | 사실 정합성 — 원본 대조(수치·진단·약물·시술·날짜) + 환각/창작 금지 | high ⛔ |
| M2 | 의학적 정확성 — 기전·정상범위·약리·순서 오류 | medium |
| M3 | 안전성 — 자가처치 유도·독성/약물 오정보·응급 경시 | severity 정의대로 (원본 모순=high) |
| M4 | 과장·오해 소지 — 완치보장·부작용 없음·부당한 일반화·마취위험 은폐(광고규정) | low |
| M5 | 용어·맥락 — 비표준/오역 용어·필수 고지(개체차·상담권고) 누락 | low |

**심각도 정의 (의학 축, 3모델 공통 판정 기준)**
- **high** = 실제 있는 사실과 틀림(내부: 원본 차트와 모순).
- **medium** = 사실은 맞지만 의학적으로 잘못·순서 뒤바뀜·일반 의학 상식에 안 맞음.
- **low** = 틀린 건 아닌데 오해·과장·불명확.

→ 안전(M3)도 이 정의를 그대로 적용(별도 high 고정 안 함). **게이트/신호등 매핑: high(사실오류) + medium(의학·순서·상식 오류, 안전 포함) → 🔴 / low(오해·과장·불명확·용어) → 🟡 / findings 없음 → 🟢.** 즉 "틀린 내용"은 빨간불, "틀리진 않았지만 문제"는 노란불.

### 축 2 — 네이버 최적화 (권고 축)
| # | 항목 | 판정 |
|---|---|---|
| S1 | 제목 — 대표키워드·지역키워드·길이·낚시/떡칠 | 결정적+LLM |
| S2 | 키워드 — 본문 대표키워드 밀도 + 연관/롱테일 커버 | 결정적+LLM |
| S3 | 형식 요건 — 분량·이미지 수·태그 수 | 결정적 |
| S4 | 구성·가독성 — 도입부 검색의도·소제목·문단 길이·마무리 CTA | 결정적+LLM |
| S5 | 독창성·품질 — 실제 1차 경험 vs 일반론, 유사문서·어뷰징 위험 | LLM |

### 결정적 목표값
| 지표 | 🔴 미흡 | 🟡 주의 | 🟢 양호 |
|---|---|---|---|
| 글자수 | <700 | 700–1200 | 1200+ |
| 이미지 | 0 | 1–2 | 3+ |
| 제목 길이 | <12 / >45자 | 12–15 / 40–45 | 15–40 |
| 소제목 | 0 | 1–2 | 3+ |
| 태그 | <3 / >30 | 3–7 | 8–15 |
| 대표키워드 밀도 | 0% / >2%(어뷰징) | 0.1–0.5% | 0.5–2% |

### 지역 키워드 근거
- 내부 = 병원 메타데이터(병원명·구/동)를 DB에서 로드 후 **결정적** 판정.
- 외부 = LLM 정성 판단.
- ⚠ 착수 시 `core.hospitals`에 구/동 필드 존재 확인. 없으면 병원명 기준으로 축소.

---

## 신호등 점등 규칙 (정량)

### 의학 (게이트 축)
| 신호 | 조건 |
|---|---|
| 🔴 미흡 | **합의된(2/3+) high 또는 medium finding ≥ 1** (사실 오류 + 의학·순서·상식 오류 + 안전) → **게시 전 수정 필요(게이트)** |
| 🟡 주의 | high/medium 0, 그러나 ① 단일 모델(1/3) high·medium 존재("확인 요망" 표시) 또는 ② low finding ≥ 1(오해·과장·불명확·용어) |
| 🟢 양호 | high/medium/low 모두 없음 |

- 빨간불은 **여러 모델이 동의한** "틀린 내용"(사실·의학·안전 오류)일 때. 단일 모델만 지적하면 노란불+확인요망(환각 오탐 방지).
- 과장·오해·불명확·용어(low)는 틀린 게 아니라 다듬을 것 → 노란불.

### 네이버 SEO (권고 축, 게이트 아님)
**치명 지표**(하나만 걸려도 크게 하락): 분량 <700자 · 이미지 0장 · 제목에 대표키워드 없음.

| 신호 | 조건 |
|---|---|
| 🔴 미흡 | 치명 지표 1개+, 또는 결정적 "미흡" 2개+, 또는 SEO medium+ findings 3개+ |
| 🟡 주의 | 결정적 "미흡" 1개, 또는 "주의" 다수, 또는 SEO medium 1–2개 |
| 🟢 양호 | 결정적 6개 모두 양호~주의(미흡 0), medium+ findings 없음 |

### 전체 판정
- 두 축 신호등 **나란히** 표시(독립).
- **"게시 부적합" 플래그 = 의학 🔴** 일 때만. SEO 🔴는 권고.

---

## 결과 표시 (3단 + 참고 접힘)
1. **한눈에**: 두 신호등 + (해당 시)게시 부적합 배너 + 한 줄 총평.
2. **의학 findings 카드**: 각 지적 = `인용문 → 문제 → 수정안` 평문. 심각도·합의도 뱃지.
3. **SEO**: 결정적 지표 6개 미니 게이지(현재값↔목표) + 개선 findings 카드.
4. **참고(저신뢰 1/3)**: 기본 접힘, "참고 N건 ▸".

원칙: 신호등=스캔용, findings=행동용. 모든 finding은 3요소(인용·문제·수정안) 평문.

### 평가 기준 보기
- 두 진입점 헤더에 `평가 기준 ⓘ` 버튼 → 드로어/모달.
- 내용: 신호등 규칙 · 10항목 설명 · 목표값 표 · 앙상블(3모델+합의) 한 단락.
- 결과 화면의 지표/신호등에서 해당 기준 항목으로 점프하면 더 좋음.
- 소스는 `@dashboard/blog-review-rubric` 하나(코드=화면 일치).

---

## 프롬프트 (확정 초안)

앙상블 = **리뷰어 프롬프트 1개(3모델 공통) + 집계 프롬프트 1개**. 프롬프트 항목 설명은 `@dashboard/blog-review-rubric` 정의에서 렌더(코드=프롬프트=화면 일치).

### 대표 키워드
- **내부**: 코드가 `caseOverview` 종+주질환명으로 자동 도출(예: "강아지 슬개골 탈구") → S1 제목 포함·S2 밀도 **결정적** 판정.
- **외부**: 코드 도출 불가 → S2 밀도는 **LLM 정성 판단**, 리뷰어가 "제목에서 대표키워드 스스로 파악".

### 리뷰어 system prompt (SYS_REVIEW) — 요지
- 두 관점(수의 전문의 / 네이버 SEO). GROUND_TRUTH 있으면 내부 대조 모드, "(없음)"이면 외부 지식 모드(원본 대조 필요분은 evidence="출처 대조 불가").
- **정량 지표(글자수·이미지·태그·소제목·키워드 출현수)는 세지 않는다**(시스템 계산). 문제점(findings)만, 좋은 점 나열 금지.
- 축1 M1~M5 / 축2 S1·S2·S4·S5(S3 형식요건은 제외 — 코드 계산).
- 각 finding: `quote`(원문 인용) · `issue`(왜 문제) · `suggestion`(대체 문구) · `evidence`. severity high/med/low.
- ★확신 낮으면 지어내지 말 것(빠뜨리는 게 나음, 교차검증됨).
- 출력 JSON: `{ medical:[{rubricId,severity,quote,issue,suggestion,evidence}], seo:[...] }`.

### 의도된 규칙 = 지적 금지 (SYS_BLOGPOST에서 추출)
글 작성 시 규칙상 일부러 제외·변형하는 것 → high/medium 금지, 최대 **low(참고 워닝)**. (의도된 것이라 무시 가능)
- ① 품종명(견종·묘종) 생략 → 일반 분류
- ② 정확한 날짜·요일 대신 상대 시점("며칠 뒤")
- ③ 약 용량·용법·제품명·브랜드명(사료·영양제·기기·키트 포함) 생략
- ④ **증상 호전의 자연스러운 서술은 창작 아님**(차트에 없어도 허용 — M1로 잡지 말 것)
- ⑤ 주제와 무관한 정상 혈액지표를 다 나열하지 않은 것(선별) → "검사 누락" 오판 금지
- ※ 개인정보·식별 노출(환자 실명·품종·정확한 날짜)은 **검수 범위 밖**(내부=의도된 것, 외부=우리 기준 강요 안 함).

### few-shot 예시 (SYS_BLOGPOST 강조점 기반, 대비형)
```
<지적해야 하는 것>
· "ALT는 520 U/L (정상 18–214)로 정상이었습니다"
  → M1/high: 520은 정상범위 초과인데 '정상'이라 서술(수치-해석 모순).
· "간 수치(빌리루빈, AST)와 췌장 수치(cPL)는 154.7 U/L로 상승했습니다"
  → M1/high: 154.7은 cPL 한 값인데 값 없는 빌리루빈·AST에 잘못 공유.
· "이 수술로 재발 걱정 없이 100% 완치됩니다"  → M4/low: 결과 보장·과장.
· 제목 "OO동물병원 슬개골 케이스"
  → S1/medium: 보호자가 검색할 주요 증상·대표키워드 부재.
<지적하지 않는 것 (의도된 규칙)>
· "수술 약 1주일 뒤 다리를 저는 모습이 사라졌습니다"(원본에 호전 기록 없음) → 없음(호전 서술 허용).
· "어느 날 증상을 발견해 며칠 뒤 내원한 소형견" → 없음(날짜·품종 생략은 규칙상 의도).
```
※ 최종본은 SYS_CAUSAL(용어 확정·창작 금지 강조)도 한 번 더 훑어 반영.

### 집계 system prompt (SYS_REVIEW_AGGREGATE) — 요지
- 세 검수(REVIEW_A/B/C)를 의미 기준으로 클러스터링 → `agreement`(3/3|2/3|1/3).
- rubricId 달라도 같은 취지면 병합(다수 rubricId), severity=최고값(안전 우선), 1/3도 버리지 않음.
- 정렬: agreement↓ → severity↓. `summary` 한 줄.
- 출력 JSON: `{ medical:[{rubricId,severity,agreement,quote,issue,suggestion,evidence}], seo:[...], summary }`.

### 입력(userContent) 조립
- 공통: `POST`(title/bodyMarkdown/tags/병원명·지역) + 대표키워드.
- 내부: `GROUND_TRUTH` = causalFlow + outline facts + caseOverview + labItemsByDate + 최종진단.
- 외부: `GROUND_TRUTH` = "(없음)".
- 결정적 지표(글자수·이미지·태그·소제목·키워드밀도·제목내 지역/대표키워드)는 코드가 별도 계산 → 지표 스트립 + 임계 findings(앙상블 미경유). **지역은 `core.hospitals.address` 앞 2토큰**(blog_post 코드와 동일 방식).
- 집계는 **별도 호출**(리뷰어 3 + 집계 1 = 4호출, 동일 operationId 1회 차감). 리뷰어 temperature 낮게(0.1~0.2).

## 위저드 변경 (apps/admin-web/components/admin-case-blog-modal.tsx)
- `StepNum = 1|2|3|4` → `1|2|3|4|5`. 라벨: 인과흐름 · 아웃라인 · 블로그글 · **글 검수** · 이미지.
- 흐름: 3 블로그글 → 4 검수(자동 생성, 읽기전용 findings/지표, 3단계로 돌아가 수정 가능) → **여기서 확정(잠금)** → 5 이미지.
- 이미지 분석 트리거를 기존 step4 진입 → **step5 진입**으로 이동.
- 검수는 **참고용(advisory)**, 진행 차단 아님.

---

## 건드릴 파일 (요약)
| 영역 | 위치 |
|---|---|
| 루브릭 단일 소스 | `packages/blog-review-rubric` (신규 `@dashboard/blog-review-rubric`) |
| 검수 엔진·앙상블·과금 | `chart-api/app/api/content/generate/route.ts` (신규 `blog_review`) + AI Gateway·SEO지표·네이버파서 유틸 |
| 단가표 | `chart-api/lib/billing/llm-pricing.ts` (xai/grok 추가, claude 갱신) |
| usage 연결 | AI SDK usage → `chart-api/lib/billing/usage-log.ts recordTokenUsage` (필요 시 wrap-clients 확장) |
| 위저드 | `apps/admin-web/components/admin-case-blog-modal.tsx` (5단계화) |
| admin 메뉴 | `apps/admin-web` 신규 페이지 + API 라우트(내부 재검수/외부 URL) |
| DB | `blog_reviews` 테이블 마이그레이션 (환불 함수는 손대지 않음) |

## 검증
- 타입: admin-web `npx tsc --noEmit`.
- chart-api: `npx tsc --noEmit` + `npm run build`(중요, [[project_chart_api_build_gotchas]]).
- 배포 필터/리전: [[project_vercel_deploy_filter]] · [[project_region_colocation]].

## 결정 로그 (사용자 확정)
- 위저드 검수 = 확정 전 참고용(비차단).
- 저장 = 이원화(내부 generated_run_content / 외부 blog_reviews).
- 외부 과금 = 지정 병원, 바른플랜 환불 적용.
- 프로바이더 연동 = Vercel AI Gateway.
- 비공통(1/3) findings = 낮은 신뢰도로 표시(참고 섹션).
- 판정 = 신호등 + findings(점수·등급 안 씀).
- 게이트 = 의학 high만.
- 지역 키워드 = 병원 메타데이터 결정적 판정(`core.hospitals.address` 앞 2토큰, 별도 구/동 필드 불필요 — 확인됨).
- 루브릭 = 10항목(의학5+SEO5) 확정.
- 대표 키워드 = 내부 자동 도출(종+주질환명) / 외부 LLM 추출.
- 집계 = 별도 호출(리뷰어 3 + 집계 1).
- 심각도 = 3단계 정의(high=사실오류 / medium=의학·순서·상식 오류 / low=오해·과장·불명확). 안전(M3)도 정의대로.
- 게이트/신호등: 🔴 = high+medium(틀린 내용: 사실·의학·안전 오류) / 🟡 = low(과장·오해·불명확·용어) / 🟢 = findings 없음. (의학 오류도 빨간불)
- 의도된 규칙(품종·날짜·약용량·호전서술·정상지표 선별)은 지적 금지(최대 low). 개인정보 노출은 검수 범위 밖.
- few-shot = SYS_BLOGPOST 강조점 기반 대비형 예시 포함.

## 미결 (착수 시 결정/확인)
- 리뷰어/집계 모델 최신 ID 확정(`claude-api` 스킬로).

## 커밋 지침
자동 커밋·푸시 금지. 항상 먼저 물어보고 진행([[feedback_commit_push]]). Co-Authored-By 라인 포함.
