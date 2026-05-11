import { AdminLoginForm } from './login-form';

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  const sp = searchParams ? await searchParams : {};
  const forbidden = sp.error === 'forbidden';

  return (
    <main style={{ maxWidth: 360, margin: '48px auto', padding: 16 }}>
      <h1 style={{ fontSize: '1.25rem' }}>관리자 로그인</h1>
      <AdminLoginForm forbidden={forbidden} />
    </main>
  );
}
