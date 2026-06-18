'use client';

import type { ReactNode } from 'react';

// 공용 모달 쉘 — 오버레이 + 가운데 패널 + 헤더(제목·× 닫기) + 바깥클릭 닫기.
// 내용물은 children, 하단 버튼은 footer 로 넘긴다. (footer 는 우측 정렬)
export function Modal({ title, onClose, children, footer, maxWidth = 520 }: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: number;
}) {
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: '0 8px 32px rgba(0,0,0,0.18)', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '16px 22px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{title}</h2>
          <button type="button" onClick={onClose} aria-label="닫기" style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 20, lineHeight: 1, color: 'var(--text-muted)' }}>×</button>
        </div>
        <div style={{ padding: '20px 22px', overflowY: 'auto' }}>{children}</div>
        {footer ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, padding: '14px 22px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
