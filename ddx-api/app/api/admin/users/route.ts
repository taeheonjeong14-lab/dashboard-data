import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isAdminByUserId } from '@/lib/admin';

// GET /api/admin/users?userId=xxx — 전체 사용자 목록 (관리자만)
export async function GET(request: NextRequest) {
  try {
    const adminUserId = new URL(request.url).searchParams.get('userId')?.trim();
    if (!adminUserId) {
      return NextResponse.json({ success: false, error: 'userId required' }, { status: 400 });
    }
    if (!(await isAdminByUserId(adminUserId))) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const users = await prisma.user.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        approved: true,
        rejected: true,
        active: true,
        hospitalId: true,
        customHospitalName: true,
        hospitalAddress: true,
        hospitalAddressDetail: true,
        createdAt: true,
        hospital: { select: { id: true, name: true } },
      },
    });

    type UserRow = (typeof users)[number];
    const list = users.map((u: UserRow) => ({
      id: u.id,
      email: u.email ?? null,
      name: u.name ?? null,
      phone: u.phone ?? null,
      approved: u.approved,
      rejected: u.rejected,
      active: u.active,
      hospitalId: u.hospitalId ?? null,
      customHospitalName: u.customHospitalName ?? null,
      hospitalAddress: u.hospitalAddress ?? null,
      hospitalAddressDetail: u.hospitalAddressDetail ?? null,
      createdAt: u.createdAt,
      hospital: u.hospital ? { id: u.hospital.id, name: u.hospital.name } : null,
    }));

    return NextResponse.json({ success: true, users: list });
  } catch (e) {
    console.error('GET /api/admin/users error:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
