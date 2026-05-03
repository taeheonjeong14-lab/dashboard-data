import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isAdminByUserId } from '@/lib/admin';
import { createClient } from '@supabase/supabase-js';

// POST /api/admin/users/[id]/delete?userId=xxx — 사용자 삭제 (관리자만)
// DB users 테이블에는 deletedAt 으로 "삭제된 계정" 기록만 남기고, Supabase Auth 에서만 삭제 → 재가입 시 새 행 생성
export async function POST(
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

    const target = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, email: true, deletedAt: true },
    });
    if (!target) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }
    const alreadySoftDeleted = !!target.deletedAt;
    if (!alreadySoftDeleted) {
      // DB: 삭제된 계정 기록만 남김 (deletedAt 설정, 행은 유지)
      await prisma.user.update({
        where: { id: targetUserId },
        data: { deletedAt: new Date() },
      });
    }

    // Supabase Auth 삭제 → 같은 이메일로 재가입 가능 (실패 시 이메일로 찾아서 재시도)
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && serviceRoleKey) {
      const supabase = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
      let authRes = await supabase.auth.admin.deleteUser(targetUserId);
      if (authRes.error && target.email) {
        // id로 삭제 실패 시(미인증 등 이슈) 이메일로 Auth 사용자 찾아서 삭제
        const { data: list } = await supabase.auth.admin.listUsers({ perPage: 1000 });
        const byEmail = list?.users?.find((u) => u.email?.toLowerCase() === target.email!.toLowerCase());
        if (byEmail) {
          authRes = await supabase.auth.admin.deleteUser(byEmail.id);
        }
      }
      if (authRes.error) {
        console.error('POST /api/admin/users/[id]/delete Auth delete failed:', authRes.error);
        return NextResponse.json(
          { success: false, error: `DB는 삭제 처리됐으나 Auth 삭제 실패: ${authRes.error.message}. Supabase 대시보드에서 수동 삭제하세요.` },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('POST /api/admin/users/[id]/delete error:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
