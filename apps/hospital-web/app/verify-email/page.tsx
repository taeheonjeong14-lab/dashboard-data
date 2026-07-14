import Link from 'next/link';

export const metadata = {
  title: '이메일 인증 완료 — VetSolution',
};

export default function VerifyEmailPage() {
  return (
    <div
      style={{
        display: 'flex',
        minHeight: '100vh',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-subtle)',
        padding: '16px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '420px',
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: '40px 32px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: '40px', marginBottom: '16px' }}>✅</div>
        <h1
          style={{
            margin: '0 0 12px',
            fontSize: '20px',
            fontWeight: 700,
            color: 'var(--text)',
          }}
        >
          이메일 인증이 완료되었습니다
        </h1>
        <p
          style={{
            margin: '0 0 24px',
            fontSize: '14px',
            color: 'var(--text-secondary)',
            lineHeight: 1.7,
          }}
        >
          관리자 승인 후 서비스를 이용할 수 있습니다.
          <br />
          승인 완료 시 가입하신 이메일로 안내드립니다.
        </p>
        <Link
          href="/login"
          style={{
            display: 'inline-block',
            padding: '9px 20px',
            fontSize: '14px',
            fontWeight: 600,
            background: 'var(--accent)',
            color: '#ffffff',
            borderRadius: 'var(--radius)',
            textDecoration: 'none',
          }}
        >
          로그인 페이지로
        </Link>
      </div>
    </div>
  );
}
