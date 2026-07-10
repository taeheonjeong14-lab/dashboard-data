'use client';

/**
 * 브라우저 오류를 /api/client-error 로 보낸다.
 * 실패해도 절대 되던지지 않는다 — 에러 화면이 에러를 내면 안 된다.
 */
export function reportClientError(error: Error & { digest?: string }, componentStack?: string): void {
  try {
    void fetch('/api/client-error', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: error.message || String(error),
        stack: error.stack,
        digest: error.digest,
        componentStack,
        pathname: typeof window !== 'undefined' ? window.location.pathname : undefined,
      }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* 무시 */
  }
}
