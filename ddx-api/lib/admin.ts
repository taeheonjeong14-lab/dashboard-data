import { createClient } from '@supabase/supabase-js';
import { prisma } from '@/lib/prisma';

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

async function authEmailForUserId(userId: string): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error || !data.user?.email) return null;
  return data.user.email.trim().toLowerCase();
}

/**
 * 관리자 판별 (우선순위):
 * 1) `core.platform_users` 에 행이 있으면 플랫폼 관리자
 * 2) 마이그레이션 폴백: `core.users.role === 'admin'`
 * 3) 마이그레이션 폴백: `ADMIN_EMAILS` + 이메일(Auth 또는 core.users)
 */
export async function isAdminByUserId(userId: string): Promise<boolean> {
  const platform = await prisma.platformUser.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (platform) return true;

  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, role: true },
  });

  if (row?.role === 'admin') return true;

  if (ADMIN_EMAILS.length === 0) return false;

  const emailFromDb = row?.email?.trim().toLowerCase() ?? null;
  if (emailFromDb) return ADMIN_EMAILS.includes(emailFromDb);

  const emailFromAuth = await authEmailForUserId(userId);
  if (!emailFromAuth) return false;
  return ADMIN_EMAILS.includes(emailFromAuth);
}
