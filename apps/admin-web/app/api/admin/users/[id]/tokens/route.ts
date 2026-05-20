import { NextRequest, NextResponse } from 'next/server';
import { requireAuthedApi } from '@/lib/require-auth-api';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { formatSupabaseError } from '@/lib/format-supabase-error';

// POST /api/admin/users/[id]/tokens — 사용자에게 토큰 지급 (body: { amount, reason? })
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireAuthedApi();
  if (!gate.ok) return gate.response;

  try {
    const { id } = await params;
    const targetUserId = String(id || '').trim();
    if (!targetUserId) {
      return NextResponse.json({ success: false, error: 'user id required' }, { status: 400 });
    }

    const body = (await request.json().catch(() => null)) as { amount?: number; reason?: string } | null;
    const amount = Math.trunc(Number(body?.amount));
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ success: false, error: '지급 토큰 수는 양의 정수여야 합니다.' }, { status: 400 });
    }

    const supabase = createServiceRoleClient();
    const { data, error } = await supabase.schema('core').rpc('token_grant', {
      p_user_id: targetUserId,
      p_amount: amount,
      p_reason: body?.reason?.trim() || 'admin_grant',
      p_created_by: gate.userId ?? null,
    });
    if (error) throw error;

    return NextResponse.json({ success: true, balance: data as number });
  } catch (e) {
    return NextResponse.json({ success: false, error: formatSupabaseError(e) }, { status: 500 });
  }
}
