'use client';

import { StickyHeader } from '@/components/ui/sticky-header';

export default function BlogContentPage() {
  return (
    <div>
      <StickyHeader>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>블로그 컨텐츠</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
            블로그 글 작성·관리 기능이 곧 추가될 예정입니다.
          </p>
        </div>
      </StickyHeader>
      <div style={{ padding: '48px 18px', textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
        준비 중입니다.
      </div>
    </div>
  );
}
