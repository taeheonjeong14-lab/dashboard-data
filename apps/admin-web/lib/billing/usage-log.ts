import { getAdminWebPgPool } from '@/lib/db';

// admin-web 은 chart-api lib 를 import 할 수 없어 OpenAI 단가/기록기를 별도로 둔다(같은 billing.llm_usage 테이블).
// 단가는 USD/100만 토큰. 수시 변동되니 주기적으로 확인.
const PRICE: Record<string, { in: number; out: number; cachedIn?: number }> = {
  'gpt-4o-mini': { in: 0.15, out: 0.6, cachedIn: 0.075 },
  'gpt-4o': { in: 2.5, out: 10.0, cachedIn: 1.25 },
  'gpt-4.1-mini': { in: 0.4, out: 1.6, cachedIn: 0.1 },
  'gpt-4.1': { in: 2.0, out: 8.0, cachedIn: 0.5 },
};

function findPrice(model: string) {
  const m = model.trim().toLowerCase();
  for (const k of Object.keys(PRICE).sort((a, b) => b.length - a.length)) {
    if (m.startsWith(k) || m.includes(k)) return PRICE[k];
  }
  return null;
}

export type UsageContext = {
  hospitalId?: string | null;
  userId?: string | null;
  feature?: string | null;
  runId?: string | null;
};

const uuidOrNull = (v: string | null | undefined): string | null =>
  typeof v === 'string' && /^[0-9a-fA-F-]{36}$/.test(v) ? v : null;

/** OpenAI Chat Completions usage(prompt_tokens/completion_tokens) → billing.llm_usage 적재. 실패해도 본 요청 안 깨짐. */
export async function recordOpenAiChatUsage(params: UsageContext & { model: string; usage: unknown }): Promise<void> {
  try {
    const u = (params.usage ?? {}) as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const input = num(u.prompt_tokens);
    const output = num(u.completion_tokens);
    const cached = num((u.prompt_tokens_details as Record<string, unknown> | undefined)?.cached_tokens);

    const p = findPrice(params.model);
    let costUsd = 0;
    if (p) {
      const billedIn = Math.max(0, input - cached);
      costUsd = (billedIn / 1e6) * p.in + (cached / 1e6) * (p.cachedIn ?? p.in) + (output / 1e6) * p.out;
    } else {
      console.warn(`[admin usage] 단가 미등록 모델 → cost 0: ${params.model}`);
    }

    const pool = getAdminWebPgPool();
    await pool.query(
      `INSERT INTO billing.llm_usage
        (hospital_id, user_id, feature, run_id, provider, model,
         input_tokens, output_tokens, cached_tokens, thinking_tokens, units, cost_usd, meta)
       VALUES ($1,$2,$3,$4,'openai',$5,$6,$7,$8,0,null,$9,null)`,
      [
        uuidOrNull(params.hospitalId),
        uuidOrNull(params.userId),
        params.feature ?? null,
        uuidOrNull(params.runId),
        params.model,
        input,
        output,
        cached,
        costUsd,
      ],
    );
  } catch (e) {
    console.warn('[admin usage] 적재 실패(무시):', e instanceof Error ? e.message : String(e));
  }
}
