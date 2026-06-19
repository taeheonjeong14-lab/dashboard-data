import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// POST /api/email-verify/check { email, code } — 인증번호 확인. 성공 시 verifiedAt 기록.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = String(body.email ?? '').trim().toLowerCase();
    const code = String(body.code ?? '').trim();
    if (!email || !/^\d{6}$/.test(code)) {
      return NextResponse.json({ success: false, error: '인증번호를 확인해 주세요.' }, { status: 400 });
    }
    const row = await prisma.emailVerification.findUnique({ where: { token: `${email}:${code}` } });
    if (!row || row.expiresAt.getTime() < Date.now()) {
      return NextResponse.json({ success: false, error: '인증번호가 올바르지 않거나 만료되었습니다.' }, { status: 400 });
    }
    await prisma.emailVerification.update({ where: { id: row.id }, data: { verifiedAt: new Date() } });
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
}
