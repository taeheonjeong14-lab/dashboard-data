import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET /api/hospitals/me?userId=xxx&email=xxx — 현재 사용자와 소속 병원 조회 (email 있으면 DB에 저장, 관리자 판별용)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId')?.trim();
    const email = searchParams.get('email')?.trim() || undefined;
    if (!userId) {
      return NextResponse.json({ success: false, error: 'userId required' }, { status: 400 });
    }

    const user = await prisma.user.upsert({
      where: { id: userId },
      create: { id: userId, ...(email && { email }) },
      update: email ? { email } : {},
      include: { hospital: true },
    });

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        hospitalId: user.hospitalId,
        approved: user.approved,
        active: user.active,
        deletedAt: user.deletedAt?.toISOString() ?? null,
        email: user.email ?? undefined,
        name: user.name ?? undefined,
        phone: user.phone ?? undefined,
        customHospitalName: user.customHospitalName ?? undefined,
        hospitalAddress: user.hospitalAddress ?? undefined,
        hospitalAddressDetail: user.hospitalAddressDetail ?? undefined,
      },
      hospital: user.hospital ? { id: user.hospital.id, name: user.hospital.name, logoUrl: user.hospital.logoUrl ?? null, brandColor: user.hospital.brandColor ?? null } : null,
    });
  } catch (e) {
    console.error('GET /api/hospitals/me error:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// PATCH /api/hospitals/me?userId=xxx — 소속 병원 선택 (body: { hospitalId })
export async function PATCH(request: NextRequest) {
  try {
    const userId = new URL(request.url).searchParams.get('userId')?.trim();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'userId required' }, { status: 400 });
    }

    const body = await request.json();
    const hospitalId = (body.hospitalId as string)?.trim() || null;

    await prisma.user.upsert({
      where: { id: userId },
      create: { id: userId, hospitalId },
      update: { hospitalId },
    });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { hospital: true },
    });

    return NextResponse.json({
      success: true,
      user: user ? { id: user.id, hospitalId: user.hospitalId } : null,
      hospital: user?.hospital ? { id: user.hospital.id, name: user.hospital.name } : null,
    });
  } catch (e) {
    console.error('PATCH /api/hospitals/me error:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
