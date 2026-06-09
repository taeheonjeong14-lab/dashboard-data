import { getChartPgPool } from '@/lib/db';
import { computeTokenCostUsd, computeUnitCostUsd, type TokenUsage } from '@/lib/billing/llm-pricing';

export type UsageContext = {
  hospitalId?: string | null;
  userId?: string | null;
  feature?: string | null;
  runId?: string | null;
  /** 한 사용자 작업(operation)을 묶는 id. 작업의 모든 LLM 호출 usage 에 동일하게 태깅 → 합산 후 1회 토큰 차감. */
  operationId?: string | null;
};

/** 1토큰 = $0.10 (원가 1:1). 변경 시 env BILLING_TOKEN_VALUE_USD 로 오버라이드. */
export const TOKEN_VALUE_USD = Number(process.env.BILLING_TOKEN_VALUE_USD) || 0.1;

type RecordBase = UsageContext & {
  provider: string;
  model: string;
  meta?: Record<string, unknown>;
};

async function insertUsage(row: {
  hospitalId: string | null;
  userId: string | null;
  feature: string | null;
  runId: string | null;
  operationId: string | null;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  thinkingTokens: number;
  units: number | null;
  costUsd: number;
  meta: Record<string, unknown> | null;
}): Promise<void> {
  // 과금 로깅은 부가 기능 — 실패해도 본 요청을 절대 깨뜨리지 않는다(삼킴).
  try {
    const pool = getChartPgPool();
    await pool.query(
      `INSERT INTO billing.llm_usage
        (hospital_id, user_id, feature, run_id, operation_id, provider, model,
         input_tokens, output_tokens, cached_tokens, thinking_tokens, units, cost_usd, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        row.hospitalId,
        row.userId,
        row.feature,
        row.runId,
        row.operationId,
        row.provider,
        row.model,
        row.inputTokens,
        row.outputTokens,
        row.cachedTokens,
        row.thinkingTokens,
        row.units,
        row.costUsd,
        row.meta ? JSON.stringify(row.meta) : null,
      ],
    );
  } catch (e) {
    console.warn('[usage-log] 적재 실패(무시):', e instanceof Error ? e.message : String(e));
  }
}

const uuidOrNull = (v: string | null | undefined): string | null =>
  typeof v === 'string' && /^[0-9a-fA-F-]{36}$/.test(v) ? v : null;

/** 토큰 기반(LLM) 사용량 기록. */
export async function recordTokenUsage(params: RecordBase & TokenUsage): Promise<void> {
  const costUsd = computeTokenCostUsd(params.model, params);
  await insertUsage({
    hospitalId: uuidOrNull(params.hospitalId),
    userId: uuidOrNull(params.userId),
    feature: params.feature ?? null,
    runId: uuidOrNull(params.runId),
    operationId: uuidOrNull(params.operationId),
    provider: params.provider,
    model: params.model,
    inputTokens: Math.max(0, params.inputTokens ?? 0),
    outputTokens: Math.max(0, params.outputTokens ?? 0),
    cachedTokens: Math.max(0, params.cachedTokens ?? 0),
    thinkingTokens: Math.max(0, params.thinkingTokens ?? 0),
    units: null,
    costUsd,
    meta: params.meta ?? null,
  });
}

/** 건당 과금 서비스(OCR 등) 사용량 기록. */
export async function recordUnitUsage(
  params: RecordBase & { unitKey: string; units: number },
): Promise<void> {
  const costUsd = computeUnitCostUsd(params.unitKey, params.units);
  await insertUsage({
    hospitalId: uuidOrNull(params.hospitalId),
    userId: uuidOrNull(params.userId),
    feature: params.feature ?? null,
    runId: uuidOrNull(params.runId),
    operationId: uuidOrNull(params.operationId),
    provider: params.provider,
    model: params.model,
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    thinkingTokens: 0,
    units: Math.max(0, params.units),
    costUsd,
    meta: params.meta ?? null,
  });
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Gemini REST/genai 응답의 usageMetadata → 토큰 사용량 추출. */
export function geminiUsageFromMetadata(
  usageMetadata: unknown,
): { inputTokens: number; outputTokens: number; cachedTokens: number; thinkingTokens: number } {
  const u = (usageMetadata ?? {}) as Record<string, unknown>;
  return {
    inputTokens: num(u.promptTokenCount),
    outputTokens: num(u.candidatesTokenCount),
    cachedTokens: num(u.cachedContentTokenCount),
    thinkingTokens: num(u.thoughtsTokenCount),
  };
}

/** OpenAI Responses API 의 usage → 토큰 사용량. (input_tokens / output_tokens) */
export function openaiResponsesUsage(usage: unknown): { inputTokens: number; outputTokens: number; cachedTokens: number } {
  const u = (usage ?? {}) as Record<string, unknown>;
  const details = (u.input_tokens_details ?? {}) as Record<string, unknown>;
  return {
    inputTokens: num(u.input_tokens),
    outputTokens: num(u.output_tokens),
    cachedTokens: num(details.cached_tokens),
  };
}

/** OpenAI Chat Completions 의 usage → 토큰 사용량. (prompt_tokens / completion_tokens) */
export function openaiChatUsage(usage: unknown): { inputTokens: number; outputTokens: number; cachedTokens: number } {
  const u = (usage ?? {}) as Record<string, unknown>;
  const details = (u.prompt_tokens_details ?? {}) as Record<string, unknown>;
  return {
    inputTokens: num(u.prompt_tokens),
    outputTokens: num(u.completion_tokens),
    cachedTokens: num(details.cached_tokens),
  };
}
