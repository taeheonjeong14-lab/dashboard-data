// 메뉴 클릭 즉시 표시되는 스켈레톤 (Suspense fallback).
// 셸(사이드바/상단바)은 유지되고 본문 영역만 이 스켈레톤으로 즉시 채워진다.
export default function Loading() {
  const bar = (w: number | string, h: number, mt = 0): React.CSSProperties => ({
    width: w,
    height: h,
    marginTop: mt,
    borderRadius: 8,
    background: 'var(--bg-raised)',
    border: '1px solid var(--border)',
    animation: 'skeleton-pulse 1.4s ease-in-out infinite',
  });

  return (
    <div>
      <style>{`@keyframes skeleton-pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.55 } }`}</style>
      {/* 헤더 자리 */}
      <div style={bar(200, 26)} />
      <div style={bar(320, 14, 10)} />

      {/* 카드 그리드 자리 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16, marginTop: 24 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} style={bar('100%', 120)} />
        ))}
      </div>

      {/* 리스트 자리 */}
      <div style={{ marginTop: 24, ...bar('100%', 260) }} />
    </div>
  );
}
