'use client';

import { useState, type CSSProperties } from 'react';
import { StickyHeader } from '@/components/ui/sticky-header';
import { CaseTab } from '@/components/blog/CaseTab';

type TabKey = 'case' | 'health-tips';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'case', label: '진료케이스' },
  { key: 'health-tips', label: '반려동물 건강상식' },
];

export default function BlogContentPage() {
  const [tab, setTab] = useState<TabKey>('case');

  return (
    <div>
      <StickyHeader>
        <div style={{ marginBottom: 16 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>블로그 컨텐츠</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
            진료케이스·건강상식 블로그 콘텐츠 자료를 등록합니다.
          </p>
        </div>

        {/* 탭 (언더라인 스타일) */}
        <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
          {TABS.map((t) => {
            const active = tab === t.key;
            const base: CSSProperties = {
              padding: '9px 12px',
              fontSize: 14,
              fontWeight: active ? 600 : 500,
              color: active ? 'var(--accent)' : 'var(--text-muted)',
              borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
              marginBottom: -1,
              background: 'none',
              border: 'none',
              borderBottomWidth: 2,
              borderBottomStyle: 'solid',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'color 0.15s',
            };
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                style={base}
                onMouseEnter={active ? undefined : (e) => { e.currentTarget.style.color = 'var(--text)'; }}
                onMouseLeave={active ? undefined : (e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </StickyHeader>

      {tab === 'case' && <CaseTab />}
      {tab === 'health-tips' && <Placeholder label="반려동물 건강상식" />}
    </div>
  );
}

function Placeholder({ label }: { label: string }) {
  return (
    <div style={{ padding: '64px 18px', textAlign: 'center' }}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>🛠️</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>곧 추가될 예정입니다.</div>
    </div>
  );
}
