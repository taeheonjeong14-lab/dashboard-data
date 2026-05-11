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

/** 관리자: `core.users.role === 'admin'` 또는 `ADMIN_EMAILS`(이메일, 대소문자 무시). DB 행이 없어도 Auth 이메일과 매치되면 허용(서비스 롤 필요). */
export async function isAdminByUserId(userId: string): Promise<boolean> {
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
