import Link from 'next/link';
import { DashboardApiSmoke } from '@/components/dashboard-api-smoke';
import { requireAdminSession } from '@/lib/require-admin';

export default async function AdminDashboardPage() {
  const user = await requireAdminSession();

  const apiBase =
    process.env.NEXT_PUBLIC_DASHBOARD_API_URL?.trim() ||
    'https://dashboard-api-jade.vercel.app';

  return (
    <main style={{ padding: 24, maxWidth: 560 }}>
      <h1 style={{ fontSize: '1.25rem' }}>관리자 대시보드 (스타브)</h1>
      <p style={{ marginTop: 8 }}>
        <strong>{user.email}</strong> 로 로그인됨
      </p>
      <p style={{ fontSize: '0.875rem', color: '#555', lineHeight: 1.5, marginTop: 12 }}>
        브라우저에서 <code>dashboard-api</code>를 호출할 때 CORS가 허용되는지 확인하는 스모크입니다.
      </p>
      <DashboardApiSmoke apiBase={apiBase} />
      <p style={{ marginTop: 24, fontSize: '0.875rem' }}>
        <Link href="/auth/signout">로그아웃</Link>
        {' · '}
        <Link href="/">홈</Link>
      </p>
    </main>
  );
}
