// admin 페이지 진입 즉시 표시되는 로딩(Suspense fallback).
// 셸(사이드바/상단바)은 유지되고 본문 영역에만 스피너가 즉시 뜬다 → 빈 화면 대기 제거.
export default function Loading() {
  return (
    <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div
        className="animate-spin"
        style={{ width: 28, height: 28, border: '3px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%' }}
        aria-label="불러오는 중"
      />
    </div>
  );
}
