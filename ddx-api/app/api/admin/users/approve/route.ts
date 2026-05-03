import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isAdminByUserId } from '@/lib/admin';
import { sendApprovedEmail } from '@/lib/email';

// POST /api/admin/users/approve — 사용자 승인 (관리자만). body: { adminUserId, targetUserId }
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const adminUserId = (body.adminUserId as string)?.trim();
    const targetUserId = (body.targetUserId as string)?.trim();
    if (!adminUserId || !targetUserId) {
      return NextResponse.json({ success: false, error: 'adminUserId, targetUserId required' }, { status: 400 });
    }
    if (!(await isAdminByUserId(adminUserId))) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const target = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { email: true, name: true, emailVerified: true },
    });
    if (!target) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }
    if (!target.emailVerified) {
      return NextResponse.json(
        { success: false, error: '이메일 인증이 완료된 후 승인할 수 있습니다.' },
        { status: 400 }
      );
    }

    await prisma.user.update({
      where: { id: targetUserId },
      data: { approved: true },
    });

    if (target.email) {
      sendApprovedEmail(target.email, target.name ?? undefined).catch(() => {});
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('POST /api/admin/users/approve error:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
