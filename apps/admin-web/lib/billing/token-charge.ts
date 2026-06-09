import { getAdminWebPgPool } from '@/lib/db';

/** 1토큰 = $0.10 (원가 1:1). chart-api 와 동일 값 유지. */
const TOKEN_VALUE_USD = Number(process.env.BILLING_TOKEN_VALUE_USD) || 0.1;

export async function getHospitalTokenBalance(hospitalId: string): Promise<number | null> {
  try {
    const { rows } = await getAdminWebPgPool().query<{ token_balance: string | number | null }>(
      `SELECT token_balance FROM core.hospitals WHERE id = $1::uuid`,
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

/** 작업 단위 토큰 차감(멱등). 실패해도 본 작업 안 깨짐. */
export async function chargeOperationTokens(
  hospitalId: string | null | undefined,
  operationId: string | null | undefined,
  feature?: string | null,
): Promise<{ tokens: number; balanceAfter: number } | null> {
  if (!hospitalId || !operationId) return null;
  try {
    const { rows } = await getAdminWebPgPool().query<{ tokens: number; balance_after: number; cost_usd: number }>(
      `SELECT * FROM billing.token_charge_operation($1::uuid, $2::uuid, $3, $4::numeric)`,
      [hospitalId, operationId, feature ?? null, TOKEN_VALUE_USD],
    );
    if (rows.length === 0) return null;
    return { tokens: Number(rows[0].tokens), balanceAfter: Number(rows[0].balance_after) };
  } catch (e) {
    console.warn('[token-charge] 차감 실패(무시):', e instanceof Error ? e.message : String(e));
    return null;
  }
}
