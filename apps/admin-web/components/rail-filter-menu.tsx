'use client';

/**
 * 2차 레일 액션 띠의 개별 필터 — 아이콘 버튼 하나 = 필터 하나, 누르면 그 필터의 드롭다운만 열린다.
 * (예전엔 '필터' 버튼 하나로 큰 패널을 열고 '적용'을 눌러야 했다 → 필터별로 쪼개고 즉시 반영)
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Filter } from 'lucide-react';

export function RailFilterMenu({
  label,
  active,
  count,
  selectedText,
  children,
}: {
  /** 버튼에 보이는 이름(예: '병원 선택') */
  label: string;
  /** 이 필터가 걸려 있는지 — 버튼을 강조색으로 */
  active?: boolean;
  /** 다중 선택 필터에서 선택 개수 배지 */
  count?: number;
  /** 선택된 값이 있으면 라벨 대신 이 값을 보여준다(예: '도담동물병원') */
  selectedText?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    // 래퍼는 position: static — 드롭다운은 버튼이 아니라 회색 띠(.adminRailActionBar) 기준으로 펼친다
    <div ref={ref} style={{ display: 'inline-flex' }}>
      <button
        type="button"
        className="adminBtnFree adminRailFilterPill"
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        title={label}
        style={{
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          maxWidth: 130,
          border: 0,
          borderRadius: 6,
          background: 'transparent',
          cursor: 'pointer',
          fontSize: 11,
          fontWeight: 600,
          color: active || open ? 'var(--accent)' : 'var(--text-muted)',
        }}
      >
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selectedText || label}
        </span>
        {count && count > 0 ? <span>({count})</span> : null}
        <span aria-hidden style={{ fontSize: 9, lineHeight: 1 }}>▾</span>
      </button>

      {open ? (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 8,
            right: 8,
            zIndex: 30,
            maxHeight: 320,
            overflowY: 'auto',
            padding: 8,
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            background: 'var(--bg)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.16)',
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>{label}</div>
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** 아이콘만 있는 필터 버튼 — 다중 선택(종류·진행 단계 등)을 한 드롭다운에 모아 담는다 */
export function RailFilterIconMenu({
  label,
  active,
  count,
  children,
}: {
  label: string;
  active?: boolean;
  count?: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    // 래퍼는 position: static — 드롭다운은 버튼이 아니라 회색 띠(.adminRailActionBar) 기준으로 펼친다
    <div ref={ref} style={{ display: 'inline-flex' }}>
      <button
        type="button"
        className="adminBtnFree"
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        title={label}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          padding: '4px 6px',
          border: 0,
          background: 'transparent',
          cursor: 'pointer',
          color: active || open ? 'var(--accent)' : 'var(--text-muted)',
        }}
      >
        <Filter size={15} fill={active ? 'currentColor' : 'none'} />
        {count && count > 0 ? <span style={{ fontSize: 11, fontWeight: 700 }}>{count}</span> : null}
      </button>

      {open ? (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 8,
            right: 8,
            zIndex: 30,
            maxHeight: 320,
            overflowY: 'auto',
            padding: 10,
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            background: 'var(--bg)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.16)',
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** 드롭다운 안 단일 선택 목록(병원·월 등) */
export function RailFilterOptions({
  value,
  options,
  allLabel,
  onChange,
  format,
}: {
  value: string;
  options: string[];
  allLabel: string;
  onChange: (v: string) => void;
  format?: (v: string) => string;
}) {
  const row = (v: string, text: string) => (
    <button
      key={v || '__all'}
      type="button"
      className="adminBtnFree"
      onClick={() => onChange(v)}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '6px 8px',
        border: 0,
        borderRadius: 6,
        background: value === v ? 'var(--accent-subtle)' : 'transparent',
        color: value === v ? 'var(--accent)' : 'var(--text-secondary)',
        fontSize: 13,
        fontWeight: value === v ? 700 : 500,
        cursor: 'pointer',
      }}
    >
      {text}
    </button>
  );
  return (
    <div style={{ display: 'grid', gap: 2 }}>
      {row('', allLabel)}
      {options.map((o) => row(o, format ? format(o) : o))}
    </div>
  );
}

/** 드롭다운 안 다중 선택 칩(종류·단계 등) */
export function RailFilterChips({
  values,
  options,
  onToggle,
}: {
  values: string[];
  options: readonly string[];
  onToggle: (v: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {options.map((o) => {
        const on = values.includes(o);
        return (
          <button
            key={o}
            type="button"
            className="adminBtnFree"
            onClick={() => onToggle(o)}
            style={{
              padding: '3px 9px',
              fontSize: 11,
              fontWeight: 700,
              borderRadius: 999,
              cursor: 'pointer',
              border: `1px solid ${on ? 'var(--accent)' : 'var(--border-strong)'}`,
              background: on ? 'var(--accent-subtle)' : '#fff',
              color: on ? 'var(--accent)' : 'var(--text-secondary)',
            }}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}
