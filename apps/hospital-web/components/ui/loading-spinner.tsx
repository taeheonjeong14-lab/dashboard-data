import type { CSSProperties } from 'react';

// 화면(또는 영역) 가운데에 표시되는 로딩 스피너.
// 서버/클라이언트 컴포넌트 모두에서 사용 가능 (훅 없음).
export function CenteredSpinner({
  label,
  minHeight,
  size = 38,
}: {
  label?: string;
  minHeight?: string | number;
  size?: number;
}) {
  const wrap: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    width: '100%',
    // 기본값: 상단바를 제외한 본문 영역을 꽉 채워 세로 중앙 정렬
    minHeight: minHeight ?? 'calc(100vh - var(--topbar-height) - 56px)',
  };
  return (
    <div style={wrap} role="status" aria-live="polite" aria-busy="true">
      <span
        aria-hidden="true"
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          border: '3px solid var(--border)',
          borderTopColor: 'var(--accent)',
          display: 'inline-block',
          animation: 'cs-spin 0.7s linear infinite',
        }}
      />
      {label ? <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>{label}</span> : null}
      <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>로딩 중</span>
      <style>{`@keyframes cs-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
