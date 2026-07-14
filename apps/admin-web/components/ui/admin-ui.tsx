'use client';

/**
 * admin 공통 UI 키트 — flat / line-divided 미감.
 * 박스(테두리+그림자) 기본 제거, 섹션은 1px 밑줄로만 구분, 토큰 색상만 사용.
 * hospital-web 의 깔끔한 마스터-디테일 패턴을 admin 전역에서 재사용하기 위한 소품 모음.
 */

import type { CSSProperties, ReactNode } from 'react';

// ── 페이지 헤더 ─────────────────────────────────────────
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
        flexWrap: 'wrap',
        marginBottom: 18,
      }}
    >
      <div>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--text)' }}>
          {title}
        </h1>
        {description ? (
          <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--text-secondary)' }}>{description}</p>
        ) : null}
      </div>
      {actions ? <div style={{ flexShrink: 0, display: 'flex', gap: 8 }}>{actions}</div> : null}
    </div>
  );
}

// ── 섹션 (박스 없음 · 위 구분선으로만 분리) ──────────────
export function Section({
  title,
  children,
  first,
}: {
  title?: string;
  children: ReactNode;
  /** 첫 섹션이면 위 구분선·여백 생략 */
  first?: boolean;
}) {
  return (
    <section
      style={{
        paddingTop: first ? 0 : 16,
        marginTop: first ? 0 : 16,
        borderTop: first ? 'none' : '1px solid var(--border)',
      }}
    >
      {title ? (
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            marginBottom: 10,
          }}
        >
          {title}
        </div>
      ) : null}
      {children}
    </section>
  );
}

// ── 라벨/값 행 ──────────────────────────────────────────
export function Field({ label, value, wide }: { label: string; value: ReactNode; wide?: boolean }) {
  return (
    <div style={wide ? { gridColumn: '1 / -1' } : undefined}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, color: 'var(--text)' }}>{value || '—'}</div>
    </div>
  );
}

export function FieldGrid({ children, columns = 2 }: { children: ReactNode; columns?: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: '10px 16px' }}>
      {children}
    </div>
  );
}

// ── 뱃지 ────────────────────────────────────────────────
type BadgeTone = 'accent' | 'muted' | 'success' | 'danger';
const BADGE_COLORS: Record<BadgeTone, { bg: string; fg: string }> = {
  accent: { bg: 'var(--accent-subtle)', fg: 'var(--accent)' },
  muted: { bg: 'var(--bg-subtle)', fg: 'var(--text-muted)' },
  success: { bg: 'var(--success-subtle)', fg: 'var(--success)' },
  danger: { bg: 'var(--danger-subtle)', fg: 'var(--danger)' },
};
export function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: BadgeTone }) {
  const c = BADGE_COLORS[tone];
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        background: c.bg,
        color: c.fg,
      }}
    >
      {children}
    </span>
  );
}

// ── 빈 상태 ─────────────────────────────────────────────
export function Empty({ title, text }: { title?: string; text: string }) {
  return (
    <div style={{ padding: '40px 16px', textAlign: 'center' }}>
      {title ? (
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>{title}</div>
      ) : null}
      <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>{text}</div>
    </div>
  );
}

// ── 알림 배너 ───────────────────────────────────────────
export function Notice({ children, danger }: { children: ReactNode; danger?: boolean }) {
  return (
    <div
      style={{
        padding: '10px 12px',
        marginBottom: 12,
        fontSize: 14,
        lineHeight: 1.5,
        borderRadius: 'var(--radius)',
        color: danger ? 'var(--danger)' : 'var(--text-secondary)',
        background: danger ? 'var(--danger-subtle)' : 'var(--bg-subtle)',
      }}
    >
      {children}
    </div>
  );
}

// ── 모달 (정당한 elevation) ─────────────────────────────
export function Modal({
  title,
  children,
  onClose,
  width = 560,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  width?: number;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: width,
          maxHeight: '88vh',
          overflowY: 'auto',
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: 24,
          boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>{title}</h2>
          <button
            type="button"
            onClick={onClose}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 20, color: 'var(--text-muted)', lineHeight: 1 }}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── 버튼 ────────────────────────────────────────────────
export function PrimaryButton({
  children,
  onClick,
  type = 'button',
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  disabled?: boolean;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '9px 16px',
        border: 'none',
        borderRadius: 'var(--radius)',
        background: 'var(--accent)',
        color: '#fff',
        fontSize: 14,
        fontWeight: 600,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

// ── 테이블 셀 스타일 (공유) ─────────────────────────────
export const thStyle: CSSProperties = {
  padding: '9px 14px',
  textAlign: 'left',
  fontWeight: 600,
  color: 'var(--text-muted)',
  fontSize: 11,
  borderBottom: '1px solid var(--border)',
  whiteSpace: 'nowrap',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};
export const tdStyle: CSSProperties = {
  padding: '11px 14px',
  color: 'var(--text-secondary)',
  whiteSpace: 'nowrap',
};
