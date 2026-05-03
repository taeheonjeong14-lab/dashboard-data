import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { prisma } from '@/lib/prisma';
import { sendVerificationEmail } from '@/lib/email';

const VERIFY_TOKEN_BYTES = 32;
const VERIFY_EXPIRE_HOURS = 24;

function getBaseUrl(): string {
  const u = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (u && u.length > 0) return u.replace(/\/$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`.replace(/\/$/, '');
  return 'http://localhost:3000';
}

// POST /api/users/profile — 회원가입 후 추가 정보 저장 (userId는 Supabase Auth uid)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const userId = (body.userId as string)?.trim();
    const email = (body.email as string)?.trim() || undefined;
    const name = (body.name as string)?.trim() || undefined;
    const phone = (body.phone as string)?.trim() || undefined;
    const hospitalId = (body.hospitalId as string)?.trim() || undefined;
    const customHospitalName = (body.customHospitalName as string)?.trim() || undefined;
    const hospitalAddress = (body.hospitalAddress as string)?.trim() || undefined;
    const hospitalAddressDetail = (body.hospitalAddressDetail as string)?.trim() || undefined;

    if (!userId) {
      return NextResponse.json({ success: false, error: 'userId required' }, { status: 400 });
    }

    const existed = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });

    // 신규 가입 시: 같은 이메일이 이미 다른 사용자로 있으면
    // - 승인/대기 중(rejected=false, deletedAt=null)이면 막기
    // - 거절됐거나 삭제된 계정만 있으면 새 행 생성 허용 (재가입, 이력은 DB에 유지)
    if (!existed && email) {
      const normalizedEmail = email.toLowerCase();
      const existingActive = await prisma.user.findFirst({
        where: {
          email: { equals: normalizedEmail, mode: 'insensitive' },
          id: { not: userId },
          rejected: false,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (existingActive) {
        return NextResponse.json({ success: false, error: '이미 사용 중인 이메일입니다.' }, { status: 400 });
      }
    }

    await prisma.user.upsert({
      where: { id: userId },
      create: {
        id: userId,
        email: email ?? null,
        name: name ?? null,
        phone: phone ?? null,
        hospitalId: hospitalId || null,
        customHospitalName: customHospitalName || null,
        hospitalAddress: hospitalAddress || null,
        hospitalAddressDetail: hospitalAddressDetail || null,
        approved: false,
        emailVerified: false,
      },
      update: {
        ...(email !== undefined && { email }),
        ...(name !== undefined && { name }),
        ...(phone !== undefined && { phone }),
        ...(hospitalId !== undefined && { hospitalId: hospitalId || null }),
        ...(customHospitalName !== undefined && { customHospitalName: customHospitalName || null }),
        ...(hospitalAddress !== undefined && { hospitalAddress: hospitalAddress || null }),
        ...(hospitalAddressDetail !== undefined && { hospitalAddressDetail: hospitalAddressDetail || null }),
      },
    });

    if (!existed && email) {
      // 가입 직후 인증 메일 1통만 발송 (가입 접수 안내는 인증 메일 본문에 포함)
      const normalizedEmail = email.toLowerCase();
      const token = randomBytes(VERIFY_TOKEN_BYTES).toString('hex');
      const expiresAt = new Date(Date.now() + VERIFY_EXPIRE_HOURS * 60 * 60 * 1000);
      await prisma.emailVerification.create({
        data: { email: normalizedEmail, token, expiresAt },
      });
      const verifyLink = `${getBaseUrl()}/verify-email?token=${token}`;
      const sendResult = await sendVerificationEmail(email, verifyLink);
      if (!sendResult.ok) {
        console.error('[profile] verification email failed:', sendResult.reason);
      }
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('POST /api/users/profile error:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
