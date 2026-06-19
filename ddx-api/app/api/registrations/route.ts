import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyPhone } from '@/lib/phone-verify';
import { isEmailRecentlyVerified } from '@/lib/send-verify';

// POST /api/registrations — 새 병원 + 마스터 동시 신청 (경로 A).
// 1) 휴대폰 본인인증 검증 → 2) 마스터 유저(core.users, role=master, 미승인) upsert
// 3) DI 중복(활성/대기)이면 차단하지 않고 플래그만(심사 화면 경고) 4) hospital_registrations 생성
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const userId = (body.userId as string)?.trim();
    const email = (body.email as string)?.trim() || undefined;
    const hospital = (body.hospital ?? {}) as Record<string, string | undefined>;
    const verify = (body.verify ?? {}) as { impUid?: string; phone?: string; name?: string };
    const marketingChannels = Array.isArray(body.marketingChannels)
      ? (body.marketingChannels as unknown[]).map(String).filter(Boolean)
      : [];

    if (!userId) return NextResponse.json({ success: false, error: 'userId required' }, { status: 400 });
    if (!hospital.name?.trim()) return NextResponse.json({ success: false, error: '병원명이 필요합니다.' }, { status: 400 });

    // 이미 사용 중(활성/대기)인 이메일이면 차단(거절/탈퇴 계정은 허용)
    if (email) {
      const dupEmail = await prisma.user.findFirst({
        where: { email: { equals: email.toLowerCase(), mode: 'insensitive' }, id: { not: userId }, rejected: false, deletedAt: null },
        select: { id: true },
      });
      if (dupEmail) return NextResponse.json({ success: false, error: '이미 사용 중인 이메일입니다.' }, { status: 400 });
    }

    const v = await verifyPhone(verify);
    if (!v.phone) return NextResponse.json({ success: false, error: '휴대폰 정보가 필요합니다.' }, { status: 400 });

    // 가입 전 인라인 이메일 인증 필수
    if (!email || !(await isEmailRecentlyVerified(email))) {
      return NextResponse.json({ success: false, error: '이메일 인증을 먼저 완료해 주세요.' }, { status: 400 });
    }

    // DI 중복(활성/대기) — 경로 A 는 차단하지 않고 플래그(심사에서 admin 이 처리)
    let diConflict = false;
    let diConflictHospital: string | null = null;
    if (v.di) {
      const dup = await prisma.user.findFirst({
        where: { di: v.di, id: { not: userId }, rejected: false, deletedAt: null },
        select: { hospitalId: true, customHospitalName: true },
      });
      if (dup) {
        diConflict = true;
        if (dup.hospitalId) {
          const h = await prisma.hospital.findUnique({ where: { id: dup.hospitalId }, select: { name: true } });
          diConflictHospital = h?.name ?? dup.customHospitalName ?? null;
        } else {
          diConflictHospital = dup.customHospitalName ?? null;
        }
      }
    }

    // 마스터 유저 (병원 미정, 미승인) — 승인 시 hospitalId 연결·활성화
    await prisma.user.upsert({
      where: { id: userId },
      create: {
        id: userId,
        email: email ?? null,
        name: v.name || null,
        phone: v.phone || null,
        hospitalRole: 'master',
        approved: false,
        emailVerified: true,
        phoneVerified: v.verified,
        verifiedName: v.name || null,
        ci: v.ci || null,
        di: v.di || null,
      },
      update: {
        ...(email !== undefined && { email }),
        name: v.name || undefined,
        phone: v.phone || undefined,
        hospitalRole: 'master',
        emailVerified: true,
        phoneVerified: v.verified,
        verifiedName: v.name || null,
        ci: v.ci || null,
        di: v.di || null,
      },
    });

    const reg = await prisma.hospitalRegistration.create({
      data: {
        hospitalName: hospital.name.trim(),
        phone: hospital.phone?.trim() || null,
        address: hospital.address?.trim() || null,
        addressDetail: hospital.addressDetail?.trim() || null,
        email: hospital.email?.trim() || null,
        directorName: hospital.directorName?.trim() || null,
        directorPhone: hospital.directorPhone?.trim() || null,
        bizCertPath: hospital.bizCertPath || null,
        vetLicensePath: hospital.vetLicensePath || null,
        masterUserId: userId,
        status: 'pending',
        diConflict,
        diConflictHospital,
        marketingChannels,
      },
    });

    return NextResponse.json({ success: true, registrationId: reg.id, diConflict });
  } catch (e) {
    console.error('POST /api/registrations error:', e);
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
}
