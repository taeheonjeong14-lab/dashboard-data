import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendVerificationCodeEmail } from '@/lib/email';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/email-verify/send { email } — 6자리 인증번호 발송 (가입 시 인라인 인증)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = String(body.email ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return NextResponse.json({ success: false, error: '올바른 이메일을 입력해 주세요.' }, { status: 400 });

    // 이미 사용 중(활성/대기) 이메일이면 막기
    const dup = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' }, rejected: false, deletedAt: null },
      select: { id: true },
    });
    if (dup) return NextResponse.json({ success: false, error: '이미 사용 중인 이메일입니다.' }, { status: 400 });

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await prisma.emailVerification.deleteMany({ where: { email } });
    await prisma.emailVerification.create({ data: { email, token: `${email}:${code}`, expiresAt } });

    const r = await sendVerificationCodeEmail(email, code);
    if (!r.ok) return NextResponse.json({ success: false, error: r.reason }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
}
