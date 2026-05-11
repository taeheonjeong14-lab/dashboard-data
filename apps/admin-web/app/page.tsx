import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { fetchDdxAdminAllowed } from '@/lib/require-admin';

export default async function AdminHomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const allowed = await fetchDdxAdminAllowed(user.id);
    if (!allowed) redirect('/login?error=forbidden');
  }

  return (
    <main style={{ padding: 24, maxWidth: 560, lineHeight: 1.6 }}>
      <h1 style={{ fontSize: '1.25rem' }}>관리자용 웹</h1>
      {user ? (
        <>
          <p>
            <strong>{user.email}</strong> 로 로그인됨
          </p>
          <p>
            <Link href="/dashboard">대시보드로 이동</Link>
          </p>
          <p style={{ fontSize: '0.875rem' }}>
            <Link href="/auth/signout">로그아웃</Link>
          </p>
        </>
      ) : (
        <>
          <p>
            통합 관리자 UI입니다. <strong>admin-ui</strong>(Vite)·<strong>vet-report</strong>·DDx 관리 기능과 병행한 뒤
            단계적으로 이관합니다.
          </p>
          <p>
            <Link href="/login">로그인</Link>
          </p>
          <p style={{ fontSize: '0.8rem', color: '#555' }}>
            로컬 개발: <code>npm run admin-web:dev</code> (3011)
          </p>
        </>
      )}
    </main>
  );
}
