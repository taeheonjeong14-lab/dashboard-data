import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendVerificationEmail } from '@/lib/email';
import { randomBytes } from 'crypto';

const TOKEN_BYTES = 32;
const EXPIRE_HOURS = 24;

// POST /api/auth/send-verify-email — 이메일 인증 링크 발송 (중복 확인된 이메일만)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = (body.email as string)?.trim()?.toLowerCase();
    if (!email) {
      return NextResponse.json({ success: false, error: 'email required' }, { status: 400 });
    }

    // 중복 여부는 signup 페이지에서 이미 확인했다고 가정. 여기서는 기존 가입자만 한 번 더 막음.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && serviceRoleKey) {
      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
      const { data: { users } } = await supabase.auth.admin.listUsers({ perPage: 1000 });
      const exists = users?.some((u) => u.email?.toLowerCase() === email);
      if (exists) {
        return NextResponse.json({ success: false, error: '이미 사용 중인 이메일입니다.' }, { status: 400 });
      }
    }

    // 이메일 인증 링크의 기준 URL. NEXT_PUBLIC_APP_URL을 설정하면 그대로 사용하고,
    // 없으면 Vercel 배포 시 VERCEL_URL(자동 주입) → 로컬이면 localhost 사용.
    // 배포 후 원하는 도메인(커스텀 도메인 등)으로 고정하려면 Vercel 환경 변수에 NEXT_PUBLIC_APP_URL 설정 권장.
    const baseUrl = (process.env.NEXT_PUBLIC_APP_URL?.trim() || '').length > 0
      ? process.env.NEXT_PUBLIC_APP_URL!.trim().replace(/\/$/, '')
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`.replace(/\/$/, '')
        : 'http://localhost:3000';
    const token = randomBytes(TOKEN_BYTES).toString('hex');
    const expiresAt = new Date(Date.now() + EXPIRE_HOURS * 60 * 60 * 1000);

    await prisma.emailVerification.create({
      data: { email, token, expiresAt },
    });

    const verifyLink = `${baseUrl.replace(/\/$/, '')}/verify-email?token=${token}`;
    const result = await sendVerificationEmail(email, verifyLink);
    if (!result.ok) {
      await prisma.emailVerification.deleteMany({ where: { token } }).catch(() => {});
      return NextResponse.json(
        { success: false, error: result.reason },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, message: '인증 메일을 보냈습니다.' });
  } catch (e) {
    console.error('POST /api/auth/send-verify-email error:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
