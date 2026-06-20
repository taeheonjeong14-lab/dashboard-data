import { NextRequest, NextResponse } from 'next/server';
import { requireAuthedApi } from '@/lib/require-auth-api';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { formatSupabaseError } from '@/lib/format-supabase-error';

// POST /api/admin/users/reset-password — body: { email }
// 선택한 사용자에게 비밀번호 재설정(복구) 메일을 발송한다.
export async function POST(request: NextRequest) {
  const gate = await requireAuthedApi();
  if (!gate.ok) return gate.response;

  try {
    const body = (await request.json().catch(() => null)) as { email?: string } | null;
    const email = body?.email?.trim();
    if (!email) {
      return NextResponse.json({ success: false, error: 'email required' }, { status: 400 });
    }

    const supabase = createServiceRoleClient();
    // 복구 메일 클릭 후 도착할 hospital-web 비밀번호 재설정 페이지.
    //   기본값은 운영 도메인. 필요 시 PASSWORD_RESET_REDIRECT_URL로 덮어쓸 수 있음.
    //   (Supabase Authentication > URL Configuration의 Redirect URLs에도 등록 필요)
    const redirectTo =
      process.env.PASSWORD_RESET_REDIRECT_URL ||
      'https://app.thehamm.kr/reset-password';
    const { error } = await supabase.auth.resetPasswordForEmail(
      email,
      redirectTo ? { redirectTo } : undefined,
    );
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: formatSupabaseError(e) },
      { status: 500 },
    );
  }
}
