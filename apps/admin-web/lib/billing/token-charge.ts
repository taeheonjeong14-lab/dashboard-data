import { getAdminWebPgPool } from '@/lib/db';

/** 1토큰 = $0.001. chart-api 와 동일 값 유지. */
const TOKEN_VALUE_USD = Number(process.env.BILLING_TOKEN_VALUE_USD) || 0.001;

export async function getHospitalTokenBalance(hospitalId: string): Promise<number | null> {
  try {
    const { rows } = await getAdminWebPgPool().query<{ token_balance: string | number | null }>(
      `SELECT token_balance FROM core.hospitals WHERE id = $1`,
      [hospitalId],
    );
    const v = rows[0]?.token_balance;
    return v == null ? null : Number(v);
  } catch {
    return null;
  }
}

/** 잔액 0 이하면 false(차단). 미설정(null)이면 true(허용). */
export async function hospitalHasTokens(hospitalId: string | null | undefined): Promise<boolean> {
  if (!hospitalId) return true;
  const bal = await getHospitalTokenBalance(hospitalId);
  if (bal == null) return true;
  return bal > 0;
}

/**
 * 바른플랜 무료 작업이면 잔액 게이트(hospitalHasTokens)를 우회한다 — 어차피 차감→즉시환불(net 0)이라
 * 잔액이 0/음수여도 실질 비용이 0이다. 게이트가 막으면 무료로 해줄 작업(바른플랜 진료케이스)이 402로 중단된다.
 * 대상: 바른플랜 활성 기간 + product ∈ {case_blog, admin_extract}. billing.token_charge_operation 의
 * 환불 대상·기간 판정과 같은 규칙 — 한쪽을 바꾸면 여기도 맞출 것. (chart-api/lib/billing/token-charge.ts 와 동일)
 */
const BARUN_FREE_GATE_PRODUCTS = new Set(['case_blog', 'admin_extract']);

export async function isBarunFreeOperation(
  hospitalId: string | null | undefined,
  product: string | null | undefined,
): Promise<boolean> {
  if (!hospitalId || !product || !BARUN_FREE_GATE_PRODUCTS.has(product)) return false;
  try {
    const { rows } = await getAdminWebPgPool().query<{ free: boolean | null }>(
      `SELECT (barun_plan_enabled
               AND (barun_plan_start IS NULL OR current_date >= barun_plan_start)
               AND (barun_plan_end   IS NULL OR current_date <= barun_plan_end)) AS free
         FROM core.hospitals WHERE id = $1`,
      [hospitalId],
    );
    return rows[0]?.free === true;
  } catch {
    return false;
  }
}

/** 작업 단위 토큰 차감(멱등). 실패해도 본 작업 안 깨짐. */
export async function chargeOperationTokens(
  hospitalId: string | null | undefined,
  operationId: string | null | undefined,
  feature?: string | null,
  product?: string | null,
): Promise<{ tokens: number; balanceAfter: number } | null> {
  if (!hospitalId || !operationId) return null;
  try {
    const { rows } = await getAdminWebPgPool().query<{ tokens: number; balance_after: number; cost_usd: number }>(
      `SELECT * FROM billing.token_charge_operation($1, $2::uuid, $3, $4::numeric, $5)`,
      [hospitalId, operationId, feature ?? null, TOKEN_VALUE_USD, product ?? null],
    );
    if (rows.length === 0) return null;
    return { tokens: Number(rows[0].tokens), balanceAfter: Number(rows[0].balance_after) };
  } catch (e) {
    console.warn('[token-charge] 차감 실패(무시):', e instanceof Error ? e.message : String(e));
    return null;
  }
}
