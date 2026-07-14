import type { ReactNode, CSSProperties } from 'react';

/**
 * 섹션 머리글 — 입력 필드 라벨보다 한 단계 위 위계.
 * 14px / 700 / var(--text). 라벨(FieldLabel: 12px/600/연한색)과 크기·굵기·색 대비로 구분된다.
 * 앱 전체 섹션 제목을 이걸로 통일해 일관성 유지.
 */
export function SectionTitle({
  children,
  hint,
  divider = false,
  style,
}: {
  children: ReactNode;
  /** 제목 옆 보조 설명(선택) */
  hint?: ReactNode;
  /** 아래 구분선 표시 여부 (기본 false) */
  divider?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div style={style}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{children}</h3>
        {hint && <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>{hint}</span>}
      </div>
      {divider && <div style={{ height: 1, background: 'var(--border)', marginTop: 8 }} />}
    </div>
  );
}

/**
 * 입력 필드 라벨 — 섹션 머리글보다 작고 연하게(12px / 600 / var(--text-secondary)).
 */
export function FieldLabel({
  children,
  required,
  hint,
}: {
  children: ReactNode;
  required?: boolean;
  hint?: ReactNode;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, marginBottom: 6 }}>
      <label style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>
        {children}
        {required && <span style={{ color: 'var(--danger)', marginLeft: 2 }}>*</span>}
      </label>
      {hint && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{hint}</span>}
    </div>
  );
}
