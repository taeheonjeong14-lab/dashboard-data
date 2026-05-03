import { NextRequest, NextResponse } from 'next/server';
import { verifyEmailByToken } from '@/lib/verify-email';

// GET /api/auth/verify-email?token=xxx — (클라이언트 fetch용) JSON 반환. 링크는 /verify-email?token=xxx 로 열면 서버에서 한 번에 인증됨.
export async function GET(request: NextRequest) {
  try {
    const token = new URL(request.url).searchParams.get('token')?.trim() ?? '';
    const result = await verifyEmailByToken(token);

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }
    return NextResponse.json({
      success: true,
      alreadyVerified: result.alreadyVerified,
      email: result.email,
      message: result.message,
    });
  } catch (e) {
    console.error('GET /api/auth/verify-email error:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : '인증 처리 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
