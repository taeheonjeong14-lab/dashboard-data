import { verifyEmailByToken } from '@/lib/verify-email';

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const t = token?.trim();
  if (!t) {
    return (
      <main>
        <h1 style={{ fontSize: '1.25rem', marginBottom: 12 }}>이메일 인증</h1>
        <p>링크가 올바르지 않습니다. (토큰 없음)</p>
      </main>
    );
  }

  const result = await verifyEmailByToken(t);

  if (!result.success) {
    return (
      <main>
        <h1 style={{ fontSize: '1.25rem', marginBottom: 12 }}>이메일 인증</h1>
        <p style={{ color: '#b91c1c' }}>{result.error}</p>
      </main>
    );
  }

  return (
    <main>
      <h1 style={{ fontSize: '1.25rem', marginBottom: 12 }}>이메일 인증</h1>
      <p style={{ marginBottom: 8 }}>{result.message}</p>
      <p style={{ opacity: 0.85, fontSize: '0.9rem' }}>{result.email}</p>
    </main>
  );
}
