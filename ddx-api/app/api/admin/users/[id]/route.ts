import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isAdminByUserId } from '@/lib/admin';

// PATCH /api/admin/users/[id]?userId=xxx — 사용자 정보 수정 (관리자만)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminUserId = new URL(request.url).searchParams.get('userId')?.trim();
    if (!adminUserId) {
      return NextResponse.json({ success: false, error: 'userId required' }, { status: 400 });
    }
    if (!(await isAdminByUserId(adminUserId))) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { id: targetUserId } = await params;
    if (!targetUserId) {
      return NextResponse.json({ success: false, error: 'user id required' }, { status: 400 });
    }

    const existing = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { deletedAt: true },
    });
    if (!existing) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }
    if (existing.deletedAt) {
      return NextResponse.json({ success: false, error: '삭제된 사용자는 수정할 수 없습니다.' }, { status: 400 });
    }

    const body = await request.json();
    const name = (body.name as string)?.trim() ?? undefined;
    const phone = (body.phone as string)?.trim() ?? undefined;
    const hospitalId = (body.hospitalId as string)?.trim() || null;
    const customHospitalName = (body.customHospitalName as string)?.trim() || null;
    const hospitalAddress = (body.hospitalAddress as string)?.trim() || null;
    const hospitalAddressDetail = (body.hospitalAddressDetail as string)?.trim() || null;
    const active = body.active as boolean | undefined;

    const user = await prisma.user.update({
      where: { id: targetUserId },
      data: {
        ...(name !== undefined && { name }),
        ...(phone !== undefined && { phone }),
        ...(active !== undefined && { active }),
        hospitalId,
        customHospitalName,
        hospitalAddress,
        hospitalAddressDetail,
      },
      include: { hospital: { select: { id: true, name: true } } },
    });

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        approved: user.approved,
        hospitalId: user.hospitalId,
        customHospitalName: user.customHospitalName,
        hospitalAddress: user.hospitalAddress,
        hospitalAddressDetail: user.hospitalAddressDetail,
        hospital: user.hospital,
      },
    });
  } catch (e) {
    console.error('PATCH /api/admin/users/[id] error:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
