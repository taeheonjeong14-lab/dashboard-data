// 대시보드 탭 전환 시 본문에 즉시 표시되는 스켈레톤 (탭 내비는 유지됨).
export default function DashboardLoading() {
  const block = (w: number | string, h: number, mt = 0): React.CSSProperties => ({
    width: w,
    height: h,
    marginTop: mt,
    borderRadius: 8,
    background: 'var(--bg-raised)',
    border: '1px solid var(--border)',
    animation: 'skeleton-pulse 1.4s ease-in-out infinite',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <style>{`@keyframes skeleton-pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.55 } }`}</style>
      <div style={block(160, 16)} />
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 150, ...block('100%', 96) }} />
        <div style={{ flex: 1, minWidth: 150, ...block('100%', 96) }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        <div style={block('100%', 220)} />
        <div style={block('100%', 220)} />
      </div>
    </div>
  );
}
