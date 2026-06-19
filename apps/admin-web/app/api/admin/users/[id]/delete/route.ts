import { NextRequest, NextResponse } from 'next/server';
import { requireAuthedApi } from '@/lib/require-auth-api';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { formatSupabaseError } from '@/lib/format-supabase-error';

// POST /api/admin/users/[id]/delete — 소프트 삭제 + Supabase Auth 삭제 (로그인만)
export async function POST(
  _request: NextRequest,
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

    const supabase = createServiceRoleClient();

    // DB: soft delete. rejected/active 도 함께 — 재가입 중복 체크가 rejected:false·deletedAt:null 을 필터하므로
    // 같은 이메일/번호로 다시 가입할 수 있게 한다.
    const { error: updErr } = await supabase
      .schema('core')
      .from('users')
      .update({ deleted_at: new Date().toISOString(), rejected: true, active: false })
      .eq('id', targetUserId);
    if (updErr) throw updErr;

    // Auth: delete (best-effort but fail loud like DDx)
    const authRes = await supabase.auth.admin.deleteUser(targetUserId);
    if (authRes.error) {
      return NextResponse.json(
        {
          success: false,
          error: `DB는 삭제 처리됐으나 Auth 삭제 실패: ${authRes.error.message}. Supabase 대시보드에서 수동 삭제하세요.`,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: formatSupabaseError(e) },
      { status: 500 },
    );
  }
}

