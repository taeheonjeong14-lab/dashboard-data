'use client';

import { useEffect } from 'react';
import { reportClientError } from '@/lib/report-client-error';

/**
 * 루트 레이아웃까지 무너진 경우. Next 가 이 컴포넌트로 html/body 를 통째로 대체하므로
 * 여기서는 globals.css 도 기대할 수 없다 — 인라인 스타일만 쓴다.
 */
export default function GlobalError({
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
    <html lang="ko">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ padding: '64px 24px', maxWidth: 560, margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>문제가 발생했습니다</h2>
          <p style={{ color: '#666', fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
            오류 내용은 운영팀에 자동으로 전달되었습니다.
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
      </body>
    </html>
  );
}
