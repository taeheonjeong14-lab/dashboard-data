'use client';

/** hospital 의 CenteredSpinner 자리 — admin 에는 같은 컴포넌트가 없어 같은 자리만 채운다. */
export function CenteredSpinner({ minHeight = '40vh' }: { minHeight?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight, color: 'var(--text-muted)', fontSize: 14 }}>
      불러오는 중…
    </div>
  );
}
