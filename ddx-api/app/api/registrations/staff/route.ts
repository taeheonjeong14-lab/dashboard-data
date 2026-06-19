import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyPhone } from '@/lib/phone-verify';
import { isEmailRecentlyVerified } from '@/lib/send-verify';

// POST /api/registrations/staff — 기존(승인된) 병원에 스태프로 가입 (경로 B).
// 휴대폰 본인인증 → DI 중복(활성/대기)이면 즉시 차단(소속 병원명 반환) → staff 유저 생성(Master 승인 대기).
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const userId = (body.userId as string)?.trim();
    const email = (body.email as string)?.trim() || undefined;
    const hospitalId = (body.hospitalId as string)?.trim();
    const verify = (body.verify ?? {}) as { impUid?: string; phone?: string; name?: string };

    if (!userId) return NextResponse.json({ success: false, error: 'userId required' }, { status: 400 });
    if (!hospitalId) return NextResponse.json({ success: false, error: '병원을 선택해 주세요.' }, { status: 400 });

    const hospital = await prisma.hospital.findUnique({ where: { id: hospitalId }, select: { id: true } });
    if (!hospital) return NextResponse.json({ success: false, error: '병원을 찾을 수 없습니다.' }, { status: 404 });

    const v = await verifyPhone(verify);
    if (!v.phone) return NextResponse.json({ success: false, error: '휴대폰 정보가 필요합니다.' }, { status: 400 });

    if (!email || !(await isEmailRecentlyVerified(email))) {
      return NextResponse.json({ success: false, error: '이메일 인증을 먼저 완료해 주세요.' }, { status: 400 });
    }

    // DI 중복(활성/대기) → 즉시 차단 + 소속 병원명
    if (v.di) {
      const dup = await prisma.user.findFirst({
        where: { di: v.di, id: { not: userId }, rejected: false, deletedAt: null },
        select: { hospitalId: true, customHospitalName: true },
      });
      if (dup) {
        let hospitalName = dup.customHospitalName ?? '';
        if (dup.hospitalId) {
          const h = await prisma.hospital.findUnique({ where: { id: dup.hospitalId }, select: { name: true } });
          hospitalName = h?.name ?? hospitalName;
        }
        return NextResponse.json(
          { success: false, code: 'DI_DUP', hospitalName, error: `이미 ${hospitalName || '다른 병원'}에 등록된 것으로 확인됩니다. 고객센터(카카오채널 @더함마케팅)로 연락 주세요.` },
          { status: 409 },
        );
      }
    }

    await prisma.user.upsert({
      where: { id: userId },
      create: {
        id: userId, email: email ?? null, name: v.name || null, phone: v.phone || null,
        hospitalId, hospitalRole: 'staff', staffApproved: false, approved: false, emailVerified: true,
        phoneVerified: v.verified, verifiedName: v.name || null, ci: v.ci || null, di: v.di || null,
      },
      update: {
        ...(email !== undefined && { email }), name: v.name || undefined, phone: v.phone || undefined,
        hospitalId, hospitalRole: 'staff', staffApproved: false, emailVerified: true,
        phoneVerified: v.verified, verifiedName: v.name || null, ci: v.ci || null, di: v.di || null,
      },
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('POST /api/registrations/staff error:', e);
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
}
