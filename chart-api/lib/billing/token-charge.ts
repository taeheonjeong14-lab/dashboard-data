import { getChartPgPool } from '@/lib/db';
import { TOKEN_VALUE_USD } from '@/lib/billing/usage-log';

/**
 * 병원 토큰 잔액 조회. 토큰 컬럼이 아직 없으면(미설정) null 반환.
 */
export async function getHospitalTokenBalance(hospitalId: string): Promise<number | null> {
  try {
    const { rows } = await getChartPgPool().query<{ token_balance: string | number | null }>(
      `SELECT token_balance FROM core.hospitals WHERE id = $1`,
      [hospitalId],
    );
    const v = rows[0]?.token_balance;
    return v == null ? null : Number(v);
  } catch {
    return null; // 컬럼/테이블 미존재 등 → 미설정으로 간주
  }
}

/**
 * 작업 전 사전 점검: 잔액이 0 이하이면 false(차단). 토큰 미설정(잔액 null)이면 true(허용).
 */
export async function hospitalHasTokens(hospitalId: string | null | undefined): Promise<boolean> {
  if (!hospitalId) return true; // 병원 미상 → 막지 않음
  const bal = await getHospitalTokenBalance(hospitalId);
  if (bal == null) return true; // 토큰 시스템 미설정 → 막지 않음
  return bal > 0;
}

/**
 * 작업(operation) 단위 토큰 차감. 그 operation 의 usage 합산원가를 토큰으로 환산해 병원 잔액에서 1회 차감.
 * 멱등(이미 청구된 작업이면 RPC가 무시). 실패해도 본 작업을 깨뜨리지 않는다.
 */
export async function chargeOperationTokens(
  hospitalId: string | null | undefined,
  operationId: string | null | undefined,
  feature?: string | null,
): Promise<{ tokens: number; balanceAfter: number } | null> {
  if (!hospitalId || !operationId) return null;
  try {
    const { rows } = await getChartPgPool().query<{ tokens: number; balance_after: number; cost_usd: number }>(
      `SELECT * FROM billing.token_charge_operation($1, $2::uuid, $3, $4::numeric)`,
      [hospitalId, operationId, feature ?? null, TOKEN_VALUE_USD],
    );
    if (rows.length === 0) return null; // 비용 0 또는 이미 청구됨
    return { tokens: Number(rows[0].tokens), balanceAfter: Number(rows[0].balance_after) };
  } catch (e) {
    console.warn('[token-charge] 차감 실패(무시):', e instanceof Error ? e.message : String(e));
    return null;
  }
}
