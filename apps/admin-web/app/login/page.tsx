import { AdminLoginForm } from './login-form';

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  const sp = searchParams ? await searchParams : {};
  const forbidden = sp.error === 'forbidden';

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'var(--bg-subtle)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 400,
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: '0 4px 24px rgba(15, 23, 42, 0.06)',
          padding: '40px 32px',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
            marginBottom: 28,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Vet Solution" style={{ height: 52, width: 'auto' }} />
          <div style={{ textAlign: 'center' }}>
            <h1 style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em', margin: 0 }}>
              관리자 로그인
            </h1>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '6px 0 0' }}>
              더함 관리자 콘솔
            </p>
          </div>
        </div>
        <AdminLoginForm forbidden={forbidden} />
      </div>
    </main>
  );
}
