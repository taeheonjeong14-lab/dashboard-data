/**
 * LLM 단가표 (USD / 100만 토큰). ★ 단가는 프로바이더가 수시로 바꾸므로 주기적으로 확인·수정할 것.
 * 토큰은 프로바이더 간 비교 불가 → 항상 "비용(USD)"으로 환산해 기록한다.
 * 모르는 모델은 cost 0 + 경고 로그(여기 표에 행을 추가하면 됨).
 */
export type ModelPrice = {
  /** 입력(프롬프트) 100만 토큰당 USD */
  inputPer1M: number;
  /** 출력(생성) 100만 토큰당 USD */
  outputPer1M: number;
  /** 캐시 입력 100만 토큰당 USD (생략 시 inputPer1M 사용) */
  cachedInputPer1M?: number;
};

// 키는 모델 ID의 소문자 prefix. 가장 긴 prefix가 우선 매칭된다.
// (예: "gpt-4o-mini" 가 "gpt-4o" 보다 먼저 매칭되도록 길이순 정렬해서 조회)
const PRICE_TABLE: Record<string, ModelPrice> = {
  // — Google Gemini —
  'gemini-2.0-flash': { inputPer1M: 0.1, outputPer1M: 0.4 },
  'gemini-2.5-flash': { inputPer1M: 0.3, outputPer1M: 2.5 },
  'gemini-2.5-pro': { inputPer1M: 1.25, outputPer1M: 10.0 },
  'gemini-1.5-flash': { inputPer1M: 0.075, outputPer1M: 0.3 },
  'gemini-1.5-pro': { inputPer1M: 1.25, outputPer1M: 5.0 },
  // — OpenAI —
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6, cachedInputPer1M: 0.075 },
  'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10.0, cachedInputPer1M: 1.25 },
  'gpt-4.1-mini': { inputPer1M: 0.4, outputPer1M: 1.6, cachedInputPer1M: 0.1 },
  'gpt-4.1': { inputPer1M: 2.0, outputPer1M: 8.0, cachedInputPer1M: 0.5 },
  // — Anthropic —
  'claude-3-5-haiku': { inputPer1M: 0.8, outputPer1M: 4.0 },
  'claude-3-5-sonnet': { inputPer1M: 3.0, outputPer1M: 15.0 },
  'claude-sonnet-4': { inputPer1M: 3.0, outputPer1M: 15.0 },
  'claude-haiku-4': { inputPer1M: 1.0, outputPer1M: 5.0 },
  'claude-opus-4': { inputPer1M: 15.0, outputPer1M: 75.0 },
  // — xAI (Grok) — ★ 단가 변동 잦음, AI Gateway 슬러그(xai/grok-*)의 include 매칭용. 착수 시 확인.
  'grok-4': { inputPer1M: 3.0, outputPer1M: 15.0 },
  'grok': { inputPer1M: 3.0, outputPer1M: 15.0 },
};

// 토큰이 아닌 서비스(건당 과금). USD / 1건(이미지·페이지 등).
const UNIT_PRICE_USD: Record<string, number> = {
  // Google Vision DOCUMENT_TEXT_DETECTION: 1,000건당 $1.5 → 건당 0.0015
  google_vision_ocr: 0.0015,
};

function findPrice(model: string): ModelPrice | null {
  const m = model.trim().toLowerCase();
  const keys = Object.keys(PRICE_TABLE).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (m.startsWith(k) || m.includes(k)) return PRICE_TABLE[k];
  }
  return null;
}

export type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  thinkingTokens?: number;
};

/** 토큰 사용량 → USD. 캐시 입력은 캐시 단가, thinking 토큰은 출력 단가로 과금. */
export function computeTokenCostUsd(model: string, usage: TokenUsage): number {
  const price = findPrice(model);
  if (!price) {
    console.warn(`[llm-pricing] 단가 미등록 모델 → cost 0 으로 기록: ${model} (llm-pricing.ts 에 추가 필요)`);
    return 0;
  }
  const input = Math.max(0, usage.inputTokens ?? 0);
  const cached = Math.max(0, usage.cachedTokens ?? 0);
  const billedInput = Math.max(0, input - cached); // 캐시분은 입력에서 분리
  const output = Math.max(0, usage.outputTokens ?? 0);
  const thinking = Math.max(0, usage.thinkingTokens ?? 0);
  const cachedRate = price.cachedInputPer1M ?? price.inputPer1M;
  return (
    (billedInput / 1e6) * price.inputPer1M +
    (cached / 1e6) * cachedRate +
    ((output + thinking) / 1e6) * price.outputPer1M
  );
}

/** 토큰 아닌 서비스(OCR 등) 건당 비용. */
export function computeUnitCostUsd(unitKey: string, units: number): number {
  const per = UNIT_PRICE_USD[unitKey];
  if (per == null) {
    console.warn(`[llm-pricing] 단가 미등록 unit 서비스 → cost 0: ${unitKey}`);
    return 0;
  }
  return per * Math.max(0, units);
}
