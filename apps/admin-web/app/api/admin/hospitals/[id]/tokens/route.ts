import { NextRequest, NextResponse } from 'next/server';
import { requireAuthedApi } from '@/lib/require-auth-api';
import { getAdminWebPgPool } from '@/lib/db';
import { formatSupabaseError } from '@/lib/format-supabase-error';

// POST /api/admin/hospitals/[id]/tokens — 병원에 토큰 지급 (body: { amount, reason? })
// 토큰은 병원 귀속(core.hospitals.token_balance). billing.token_grant 로 지급+원장 기록.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireAuthedApi();
  if (!gate.ok) return gate.response;

  try {
    const { id } = await params;
    const hospitalId = String(id || '').trim();
    if (!hospitalId) {
      return NextResponse.json({ success: false, error: 'hospital id required' }, { status: 400 });
    }

    const body = (await request.json().catch(() => null)) as { amount?: number; reason?: string } | null;
    const amount = Math.trunc(Number(body?.amount));
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ success: false, error: '지급 토큰 수는 양의 정수여야 합니다.' }, { status: 400 });
    }

    const note = body?.reason?.trim() || 'admin_grant';
    const { rows } = await getAdminWebPgPool().query<{ balance: string | null }>(
      'SELECT billing.token_grant($1, $2, $3, $4) AS balance',
      [hospitalId, amount, note, 'grant'],
    );
    return NextResponse.json({ success: true, balance: Number(rows[0]?.balance ?? 0) });
  } catch (e) {
    return NextResponse.json({ success: false, error: formatSupabaseError(e) }, { status: 500 });
  }
}
