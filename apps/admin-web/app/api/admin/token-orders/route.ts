import { NextRequest, NextResponse } from 'next/server';
import { requireAuthedApi } from '@/lib/require-auth-api';
import { getAdminWebPgPool } from '@/lib/db';
import { formatSupabaseError } from '@/lib/format-supabase-error';
import { notifyHospitalUsers } from '@/lib/notify';

// GET /api/admin/token-orders — 토큰 구매 주문 목록(입금 대기 우선)
export async function GET() {
  const gate = await requireAuthedApi();
  if (!gate.ok) return gate.response;
  try {
    const { rows } = await getAdminWebPgPool().query(`
      SELECT o.id, o.order_no, o.hospital_id, h.name AS hospital_name,
             o.base_tokens, o.bonus_tokens, o.total_tokens, o.price_krw, o.status,
             o.created_at, o.paid_at
        FROM billing.token_orders o
        LEFT JOIN core.hospitals h ON h.id = o.hospital_id::text
       ORDER BY (o.status = 'pending') DESC, o.created_at DESC
       LIMIT 200`);
    return NextResponse.json({ orders: rows });
  } catch (e) {
    return NextResponse.json({ error: formatSupabaseError(e) }, { status: 500 });
  }
}

// POST /api/admin/token-orders — body { orderId } → 입금 확인 완료(충전)
export async function POST(request: NextRequest) {
  const gate = await requireAuthedApi();
  if (!gate.ok) return gate.response;
  try {
    const body = (await request.json().catch(() => null)) as { orderId?: string } | null;
    const orderId = String(body?.orderId ?? '').trim();
    if (!orderId) return NextResponse.json({ success: false, error: 'orderId required' }, { status: 400 });
    const pool = getAdminWebPgPool();
    const { rows: ords } = await pool.query<{ hospital_id: string; total_tokens: number; order_no: string }>(
      'SELECT hospital_id, total_tokens, order_no FROM billing.token_orders WHERE id = $1::uuid',
      [orderId],
    );
    const { rows } = await pool.query<{ result: string }>(
      'SELECT billing.confirm_token_order($1::uuid, $2::uuid) AS result',
      [orderId, gate.userId ?? null],
    );
    const result = rows[0]?.result;
    if (result !== 'ok') {
      return NextResponse.json({ success: false, error: result ?? 'failed' }, { status: 400 });
    }
    // 입금 확인 → 병원 마스터에게 충전 완료 알림
    const ord = ords[0];
    if (ord) {
      await notifyHospitalUsers(String(ord.hospital_id), {
        type: 'token_granted',
        title: '토큰 구매 완료',
        body: `구매가 확정되어 ${Number(ord.total_tokens).toLocaleString()}토큰 지급이 완료되었습니다 👏`,
      }, { role: 'master' });
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ success: false, error: formatSupabaseError(e) }, { status: 500 });
  }
}
