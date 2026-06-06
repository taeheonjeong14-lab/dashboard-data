'use client';

import { StickyHeader } from '@/components/ui/sticky-header';

export default function SchedulePage() {
  return (
    <div>
      <StickyHeader>
        <div style={{ marginBottom: 16 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>디자인 요청</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
            디자인 요청 자료를 등록합니다.
          </p>
        </div>
      </StickyHeader>

      <div style={{ padding: '64px 18px', textAlign: 'center' }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>🛠️</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>디자인 요청</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>곧 추가될 예정입니다.</div>
      </div>
    </div>
  );
}
