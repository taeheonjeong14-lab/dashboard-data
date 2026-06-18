import type { CSSProperties } from 'react';

// hospital-web 공용 입력 폼 스타일 — 본격 입력폼·인증 페이지에서 공유한다.
// 단일 줄 입력/select 는 박스 대신 '밑줄'만, 여러 줄 textarea 는 박스 유지.

export const inputStyle: CSSProperties = {
  width: '100%', padding: '8px 2px', border: 'none', borderBottom: '1px solid var(--border-strong)', borderRadius: 0,
  background: 'transparent', color: 'var(--text)', fontSize: 13.5, boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit',
};

export const selectStyle: CSSProperties = {
  ...inputStyle, cursor: 'pointer',
};

export const textareaStyle: CSSProperties = {
  width: '100%', padding: '10px 12px', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius)',
  background: 'var(--bg)', color: 'var(--text)', fontSize: 13.5, boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit',
};

// ── 버튼 톤 (전 화면 공용 기준) ──
// 보조 액션: 무테 고스트 텍스트(hover 시 진해짐 — 사용처에서 onMouseEnter/Leave 로 color 토글).
export const ghostBtnStyle: CSSProperties = {
  padding: '10px 14px', border: 'none', background: 'transparent', color: 'var(--text-secondary)',
  fontSize: 13.5, fontWeight: 600, cursor: 'pointer', borderRadius: 'var(--radius)', transition: 'color 0.15s ease',
};
// 주 액션(일반): accent 로 채운 살짝 둥근 버튼(기존 카드/입력과 동일한 var(--radius)).
export function primaryPillStyle(disabled?: boolean): CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 20px',
    border: 'none', borderRadius: 'var(--radius)',
    background: disabled ? 'var(--bg-raised)' : 'var(--accent)', color: disabled ? 'var(--text-muted)' : '#fff',
    fontSize: 13.5, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
  };
}
// 주 액션(카카오 발송): 카카오 노란색 살짝 둥근 버튼. 앞에 카카오 로고 SVG 와 함께 사용.
export function kakaoPillStyle(disabled?: boolean): CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 18px', border: 'none', borderRadius: 'var(--radius)',
    background: disabled ? 'var(--bg-raised)' : '#fae100', color: disabled ? 'var(--text-muted)' : '#3c1e1e',
    fontSize: 13.5, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
  };
}

// 알약형 세그먼트 토글 (예: 초진/재진). 선택된 옵션만 accent 로 채워진다.
export function SegmentedToggle({ options, value, onChange, padX = 24 }: {
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
  padX?: number;
}) {
  return (
    <div style={{ display: 'inline-flex', gap: 2, padding: 3, background: 'var(--bg-subtle)', borderRadius: 999, border: '1px solid var(--border)' }}>
      {options.map((opt) => {
        const on = value === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            style={{
              padding: `7px ${padX}px`, borderRadius: 999, border: 'none',
              background: on ? 'var(--accent)' : 'transparent',
              color: on ? '#fff' : 'var(--text-secondary)',
              fontSize: 13, fontWeight: on ? 700 : 500, cursor: 'pointer',
              transition: 'background 0.15s ease, color 0.15s ease',
            }}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}
