import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isAdminByUserId } from '@/lib/admin';

// PATCH /api/admin/hospitals/[id]?userId=xxx — 병원 정보 수정 (관리자만)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = new URL(request.url).searchParams.get('userId')?.trim();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'userId required' }, { status: 400 });
    }
    if (!(await isAdminByUserId(userId))) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { id: hospitalId } = await params;
    if (!hospitalId) {
      return NextResponse.json({ success: false, error: 'hospital id required' }, { status: 400 });
    }

    const body = await request.json();
    const name = (body.name as string)?.trim();
    const address = (body.address as string)?.trim() || null;
    const addressDetail = (body.addressDetail as string)?.trim() || null;
    const brandColor = (body.brandColor as string)?.trim() || null;

    if (!name) {
      return NextResponse.json({ success: false, error: 'name required' }, { status: 400 });
    }

    const hospital = await prisma.hospital.update({
      where: { id: hospitalId },
      data: { name, address, addressDetail, brandColor },
    });

    return NextResponse.json({
      success: true,
      hospital: {
        id: hospital.id,
        name: hospital.name,
        address: hospital.address,
        addressDetail: hospital.addressDetail,
        logoUrl: hospital.logoUrl,
        brandColor: hospital.brandColor,
      },
    });
  } catch (e) {
    console.error('PATCH /api/admin/hospitals/[id] error:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
