import { NextRequest, NextResponse } from 'next/server';
import { requireAuthedApi } from '@/lib/require-auth-api';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { formatSupabaseError } from '@/lib/format-supabase-error';

// POST /api/admin/users/approve — body: { targetUserId }
export async function POST(request: NextRequest) {
  const gate = await requireAuthedApi();
  if (!gate.ok) return gate.response;

  try {
    const body = (await request.json().catch(() => null)) as { targetUserId?: string } | null;
    const targetUserId = body?.targetUserId?.trim();
    if (!targetUserId) {
      return NextResponse.json({ success: false, error: 'targetUserId required' }, { status: 400 });
    }

    const supabase = createServiceRoleClient();

    // 이메일 인증 전이면 승인 불가
    const { data: target } = await supabase
      .schema('core')
      .from('users')
      .select('emailVerified')
      .eq('id', targetUserId)
      .maybeSingle();
    if (target && (target as { emailVerified?: boolean }).emailVerified !== true) {
      return NextResponse.json(
        { success: false, error: '이메일 인증을 완료하지 않은 사용자는 승인할 수 없습니다.' },
        { status: 409 },
      );
    }

    const { error } = await supabase
      .schema('core')
      .from('users')
      .update({ approved: true, rejected: false, active: true })
      .eq('id', targetUserId);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: formatSupabaseError(e) },
      { status: 500 },
    );
  }
}

