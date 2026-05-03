import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isAdminByUserId } from '@/lib/admin';
import { createClient } from '@supabase/supabase-js';
import { sendRejectedEmail } from '@/lib/email';

// POST /api/admin/users/reject — 가입 승인 거절 (관리자만). body: { adminUserId, targetUserId }
// 거절 시 DB에는 rejected=true 로 기록하고, Supabase Auth 계정은 삭제 → 같은 이메일로 재가입 가능
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
      select: { id: true, approved: true, email: true, name: true },
    });
    if (!target) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }
    if (target.approved) {
      return NextResponse.json(
        { success: false, error: '이미 승인된 사용자는 거절할 수 없습니다.' },
        { status: 400 }
      );
    }

    await prisma.user.update({
      where: { id: targetUserId },
      data: { rejected: true, active: false },
    });

    // Supabase Auth에서 해당 사용자 삭제 → 같은 이메일로 다시 가입 가능
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && serviceRoleKey) {
      const supabase = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
      let authRes = await supabase.auth.admin.deleteUser(targetUserId);
      if (authRes.error && target.email) {
        const { data: list } = await supabase.auth.admin.listUsers({ perPage: 1000 });
        const byEmail = list?.users?.find((u) => u.email?.toLowerCase() === target.email!.toLowerCase());
        if (byEmail) {
          authRes = await supabase.auth.admin.deleteUser(byEmail.id);
        }
      }
      if (authRes.error) {
        console.error('POST /api/admin/users/reject Auth delete failed:', authRes.error);
        return NextResponse.json(
          { success: false, error: `거절은 처리됐으나 Auth 삭제 실패: ${authRes.error.message}. Supabase 대시보드에서 수동 삭제하세요.` },
          { status: 500 }
        );
      }
    }

    // 거절 안내 이메일 발송 (문의: cs@babanlabs.com) — 실패 시 로그만 남기고 성공 응답은 유지
    let emailSent = false;
    if (target.email) {
      try {
        emailSent = await sendRejectedEmail(target.email, target.name ?? undefined);
        if (!emailSent) {
          console.warn('[reject] sendRejectedEmail failed or RESEND_API_KEY missing for', target.email);
        }
      } catch (e) {
        console.error('[reject] sendRejectedEmail error:', e);
      }
    }

    return NextResponse.json({ success: true, emailSent });
  } catch (e) {
    console.error('POST /api/admin/users/reject error:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
