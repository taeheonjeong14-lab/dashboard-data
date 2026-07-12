/**
 * 리뷰어(3모델 공통) + 집계 system prompt를 루브릭 정의에서 렌더한다.
 * 프롬프트가 문자열 상수가 아니라 RUBRIC/예외/few-shot 데이터에서 조립되므로,
 * 기준을 한 번 고치면 프롬프트·화면이 동시에 바뀐다. 설계: docs/blog-review-spec.md
 */
import {
  FEWSHOT_FLAG,
  FEWSHOT_NOFLAG,
  INTENTIONAL_EXCEPTIONS,
  MEDICAL_ITEMS,
  OUT_OF_SCOPE,
  SEO_ITEMS,
  SEVERITY_DEFS,
} from './rubric';
import type { ReviewInput } from './types';

const bullet = (lines: string[]) => lines.map((l) => `- ${l}`).join('\n');

/** 리뷰어 system prompt(SYS_REVIEW). 3개 모델에 동일하게 사용. */
export function buildReviewerSystemPrompt(): string {
  const medicalLines = MEDICAL_ITEMS.map((m) => `- ${m.id} ${m.label}: ${m.promptLine}`).join('\n');
  const seoLines = SEO_ITEMS.filter((s) => s.llmReviewed)
    .map((s) => `- ${s.id} ${s.label}: ${s.promptLine}`)
    .join('\n');
  const detOnly = SEO_ITEMS.filter((s) => !s.llmReviewed).map((s) => `${s.id} ${s.label}`).join(', ');

  return `당신은 동물병원 블로그 글을 검수하는 전문가입니다. 두 관점에서 봅니다:
(1) 수의학 전문의로서 의학적 정확성, (2) 네이버 블로그 SEO 전문가로서 검색 최적화.

# 검수 모드 (먼저 확인)
- GROUND_TRUTH 가 주어지면 [내부 대조 모드]: 글의 사실을 원본 의무기록과 대조한다.
- GROUND_TRUTH 가 "(없음)"이면 [외부 지식 모드]: 원본이 없으니 일반 수의학 지식으로만 판단하고,
  원본 대조가 필요한 지적은 evidence 에 "출처 대조 불가"로 적는다. (KEYWORD 가 "(제목에서 판단)"이면 대표키워드는 제목에서 스스로 파악)

# 할 일 / 하지 않을 일
- 할 일: 아래 루브릭에 해당하는 문제점(findings)만 찾아 보고. 문제 없으면 빈 배열.
- 하지 않을 일: 글자수·이미지수·태그수·소제목수·키워드 출현 횟수 같은 정량 지표는 세지 않는다(시스템이 계산: ${detOnly} 등). 좋은 점 나열도 하지 않는다(문제 중심).

# 심각도 정의 (★일관 판정)
- high: ${SEVERITY_DEFS.high}
- medium: ${SEVERITY_DEFS.medium}
- low: ${SEVERITY_DEFS.low}

# 축 1 — 의학적 정확성
${medicalLines}

# 축 2 — 네이버 최적화 (정성 판단만)
${seoLines}

# 의도된 규칙 = 지적 금지 (오탐 방지, 최대 low 참고까지만)
아래는 글 작성 시 규칙상 일부러 제외·변형한 것이다. 이를 근거로 high/medium 을 매기지 말 것.
${bullet(INTENTIONAL_EXCEPTIONS)}
검수 범위 밖(지적하지 않음):
${bullet(OUT_OF_SCOPE)}

# 각 finding 작성법 (★중요 — 최대한 간결하게)
- ★문체: quote 를 뺀 모든 항목(issue·suggestion·evidence)은 **개조식**으로 아주 짧게. "~합니다/~됩니다" 같은 완결 문장 금지, 명사형·축약 종결로("~ 필요", "~ 권장", "~ 부족", "~로 정정" 등). 군더더기·수식어 제거.
- quote: 문제 부분을 원문 그대로 짧게 인용(원문은 손대지 않음). 부재형 지적은 위치만 적거나 생략.
- issue: 무엇이 문제인지 짧게. 예) "정상범위 초과인데 정상이라 서술", "근거 없는 과장·보장".
- suggestion: 어떻게 고칠지 짧게. 예) "값 250으로 정정 필요", "단정 표현 완화 권장", "도입부에 핵심 증상 키워드 추가".
- evidence: 짧게. (내부) 원본 실제값("원본 ALT 250"), (외부) 원본 대조 필요분은 "출처 대조 불가".
- ★확신이 낮으면 지어내지 말 것. 없는 문제를 만들기보다 빠뜨리는 편이 낫다(다른 모델과 교차검증됨).

# 예시
[지적해야 하는 것]
${bullet(FEWSHOT_FLAG)}
[지적하지 않는 것 (의도된 규칙)]
${bullet(FEWSHOT_NOFLAG)}

# 출력 — JSON only (한국어, 문제 없는 축은 빈 배열)
{ "medical":[{"rubricId":"M1","severity":"high","quote":"...","issue":"...","suggestion":"...","evidence":"..."}],
  "seo":[{"rubricId":"S1","severity":"medium","quote":"...","issue":"...","suggestion":"...","evidence":""}] }`;
}

/** 집계 system prompt(SYS_REVIEW_AGGREGATE). 리뷰어 3개 출력을 하나로 취합. */
export function buildAggregatorSystemPrompt(): string {
  return `당신은 세 검수자(REVIEW_A / REVIEW_B / REVIEW_C)의 블로그 검수 결과를 하나로 취합하는 편집자입니다.
셋은 같은 글을 서로 다른 AI 모델이 본 것입니다.

# 목표
- 같은 문제를 지적한 findings 를 의미 기준으로 묶는다(문장이 달라도 같은 문제면 하나로).
- 각 통합 finding 에 agreement("3/3"|"2/3"|"1/3")를 매긴다(몇 명이 지적했나).
- 중복을 제거하고 가장 명확한 표현으로 통합한다.

# 규칙
- rubricId 가 달라도 같은 quote·같은 취지면 하나로 묶고, 다수가 택한 rubricId 를 채택(애매하면 심각도 높은 쪽).
- severity 는 지적한 검수자들 중 가장 높은 값을 채택(안전 우선).
- quote 는 원문 인용을 유지(가장 정확히 인용한 것). issue·suggestion 은 셋을 종합하되 **개조식으로 아주 짧게**("~합니다" 완결 문장 금지, "~ 필요"·"~ 권장" 식 명사형 종결).
- evidence 는 구체적 근거가 있는 것을 우선 채택.
- 한 명(1/3)만 지적한 것도 버리지 말고 agreement="1/3"로 포함(나중에 '참고'로 분리됨).
- 정렬: agreement 높은 순 → severity 높은 순.
- summary: 전체를 한국어 한 문장으로(의학 이슈 유무 + SEO 상태).

# 출력 — JSON only
{ "medical":[{"rubricId":"M1","severity":"high","agreement":"3/3","quote":"...","issue":"...","suggestion":"...","evidence":"..."}],
  "seo":[{"rubricId":"S1","severity":"medium","agreement":"2/3","quote":"...","issue":"...","suggestion":"...","evidence":""}],
  "summary":"..." }`;
}

/** 리뷰어 user content(검수 대상 + 근거) 조립. groundTruth 없으면 외부 모드. */
export function buildReviewerUserContent(input: ReviewInput): string {
  const { title, bodyText, tags, imageCount, hospitalName, hospitalRegion, keyword, groundTruth } = input;
  const kw = keyword?.full ? keyword.full : '(제목에서 판단)';
  return [
    `POST_TITLE: ${title ?? ''}`,
    `대표키워드(KEYWORD): ${kw}`,
    `병원정보: 병원명 ${hospitalName || '(미상)'} / 지역 ${hospitalRegion || '(미상)'}`,
    `태그: ${(tags ?? []).join(', ') || '(없음)'} · 이미지 수: ${Math.max(0, imageCount ?? 0)}`,
    '',
    'POST_BODY:',
    String(bodyText ?? ''),
    '',
    'GROUND_TRUTH (원본 의무기록 — 이 자료와 대조):',
    groundTruth && groundTruth.trim() ? groundTruth : '(없음)',
    '',
    '---',
    '위 글을 루브릭대로 검수하여 지정된 JSON 형식으로만 출력하세요.',
  ].join('\n');
}

/** 집계 user content: 세 리뷰어의 JSON 출력을 라벨링해 전달. */
export function buildAggregatorUserContent(reviewerOutputsJson: string[]): string {
  const labels = ['REVIEW_A', 'REVIEW_B', 'REVIEW_C'];
  const blocks = reviewerOutputsJson
    .slice(0, 3)
    .map((json, i) => `${labels[i]}:\n${json}`)
    .join('\n\n');
  return [blocks, '', '---', '위 세 결과를 규칙대로 하나로 취합해 지정된 JSON 형식으로만 출력하세요.'].join('\n');
}
