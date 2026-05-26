import { Suspense, type ReactNode } from 'react';
import { requireAdminSession } from '@/lib/require-admin';
import { createClient } from '@/lib/supabase/server';
import { AdminShell } from '@/components/admin-shell';
import './admin-legacy.css';

export const dynamic = 'force-dynamic';

export default async function AdminSectionLayout({ children }: { children: ReactNode }) {
  const user = await requireAdminSession();

  // 사용자 이름: core.users.name 우선, 없으면 metadata.name, 마지막 이메일 fallback (hospital-web 과 동일 규칙).
  let coreName: string | null = null;
  try {
    const sb = await createClient();
    const { data } = await sb.schema('core').from('users').select('name').eq('id', user.id).single();
    const n = (data as { name?: string | null } | null)?.name;
    if (typeof n === 'string' && n.trim()) coreName = n.trim();
  } catch {
    /* 이름 조회 실패해도 shell 은 그려야 함 */
  }
  const userName =
    coreName ||
    (typeof user.user_metadata?.name === 'string' ? user.user_metadata.name.trim() : '') ||
    user.email ||
    null;

  return (
    <Suspense>
      <AdminShell userName={userName} userEmail={user.email ?? null}>
        {children}
      </AdminShell>
    </Suspense>
  );
}
