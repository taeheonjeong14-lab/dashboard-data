import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isAdminByUserId } from '@/lib/admin';

// GET /api/admin/users/pending?userId=xxx — 승인 대기 사용자 목록 (관리자만)
export async function GET(request: NextRequest) {
  try {
    const adminUserId = new URL(request.url).searchParams.get('userId')?.trim();
    if (!adminUserId) {
      return NextResponse.json({ success: false, error: 'userId required' }, { status: 400 });
    }
    if (!(await isAdminByUserId(adminUserId))) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const pendingWhere = { approved: false, rejected: false, deletedAt: null };
    const [users, totalCount, pendingCount] = await Promise.all([
      prisma.user.findMany({
        where: pendingWhere,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          name: true,
          phone: true,
          customHospitalName: true,
          hospitalAddress: true,
          hospitalAddressDetail: true,
          emailVerified: true,
          createdAt: true,
          hospital: { select: { id: true, name: true } },
        },
      }),
      prisma.user.count(),
      prisma.user.count({ where: pendingWhere }),
    ]);

    return NextResponse.json({ success: true, users, totalCount, pendingCount });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    const stack = e instanceof Error ? e.stack : undefined;
    console.error('GET /api/admin/users/pending error:', e);
    return NextResponse.json(
      { success: false, error: message, ...(process.env.NODE_ENV === 'development' && stack && { debug: stack }) },
      { status: 500 }
    );
  }
}
