import { redirect } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

/** 서버에서만 호출. ddx-api `GET /api/admin/check` 결과로 관리자 여부 판별 */
export async function fetchDdxAdminAllowed(userId: string): Promise<boolean> {
  const base = process.env.DDX_API_BASE_URL?.trim();
  if (!base) return false;
  const url = `${base.replace(/\/$/, '')}/api/admin/check?userId=${encodeURIComponent(userId)}`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean; allowed?: boolean };
    return Boolean(data.success && data.allowed);
  } catch {
    return false;
  }
}

/** 세션 필수 + ddx-api 기준 관리자만 통과. 아니면 `/login` 또는 `forbidden`으로 리다이렉트 */
export async function requireAdminSession(): Promise<User> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const allowed = await fetchDdxAdminAllowed(user.id);
  if (!allowed) redirect('/login?error=forbidden');
  return user;
}
