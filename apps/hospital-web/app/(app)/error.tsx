'use client';

import { useEffect } from 'react';
import { reportClientError } from '@/lib/report-client-error';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError(error);
  }, [error]);

  return (
    <div style={{ padding: '48px 24px', maxWidth: 560, margin: '0 auto', textAlign: 'center' }}>
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>화면을 불러오지 못했습니다</h2>
      <p style={{ color: '#666', fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
        오류 내용은 운영팀에 자동으로 전달되었습니다.
        <br />
        잠시 후 다시 시도해 주세요.
      </p>
      <button
        type="button"
        onClick={reset}
        style={{
          padding: '10px 20px',
          borderRadius: 8,
          border: '1px solid #d4d4d8',
          background: '#fff',
          cursor: 'pointer',
          fontSize: 14,
        }}
      >
        다시 시도
      </button>
      {error.digest ? (
        <p style={{ marginTop: 20, color: '#9ca3af', fontSize: 12 }}>오류 코드: {error.digest}</p>
      ) : null}
    </div>
  );
}
