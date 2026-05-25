import type { ReactNode } from 'react';

// 스크롤해도 상단(제목/탭)이 고정되도록 감싸는 래퍼.
// 셸 main 의 상단 패딩(28px)을 음수 마진으로 상쇄한 뒤 다시 패딩으로 복원해
// 평소 위치는 그대로 유지하면서, 고정 시 상단바(--topbar-height) 바로 아래에 붙는다.
export function StickyHeader({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        position: 'sticky',
        top: 'var(--topbar-height)',
        zIndex: 20,
        background: 'var(--bg-subtle)',
        marginTop: -28,
        paddingTop: 28,
        paddingBottom: 16,
      }}
    >
      {children}
    </div>
  );
}
