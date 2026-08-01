'use client';

/**
 * 리포트 본문 편집용 textarea — 선택 영역을 Ctrl+B / Ctrl+I 로 `**볼드**` · `*이탤릭*` 로 감싼다.
 *
 * 왜 WYSIWYG 이 아니라 이것인가: 저장 형식이 계속 평문이라 DB·LLM 파이프라인이 그대로다.
 * 사용자는 별표를 직접 칠 필요가 없고(손으로 치면 짝을 자주 틀린다), 눌렀다 다시 누르면 풀린다.
 *
 * admin 편집창과 외부 검토 링크가 같은 컴포넌트를 쓴다 — 두 화면에서 서식 동작이 갈리면 안 된다.
 */
import { useRef, type CSSProperties, type ReactNode, type TextareaHTMLAttributes } from 'react';

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange' | 'value'> & {
  value: string;
  onChange: (next: string) => void;
  /** 툴바 우측에 덧붙일 것(글자 수 등). */
  toolbarExtra?: ReactNode;
  toolbarStyle?: CSSProperties;
};

const WRAPPERS = { bold: '**', italic: '*' } as const;

/**
 * 선택 영역을 마커로 감싸거나(이미 감싸져 있으면) 벗긴다.
 * 선택이 없으면 마커만 넣고 커서를 가운데 둔다 — 바로 이어 타이핑할 수 있게.
 */
export function toggleWrap(text: string, start: number, end: number, marker: string): { next: string; selStart: number; selEnd: number } {
  const before = text.slice(0, start);
  const sel = text.slice(start, end);
  const after = text.slice(end);
  const n = marker.length;

  // 선택 **바깥**이 이미 마커면 벗긴다(사용자가 감싼 글자만 다시 선택하는 경우).
  if (before.endsWith(marker) && after.startsWith(marker)) {
    return {
      next: before.slice(0, -n) + sel + after.slice(n),
      selStart: start - n,
      selEnd: end - n,
    };
  }
  // 선택 **안쪽**이 마커로 시작·끝나면 벗긴다.
  if (sel.length >= n * 2 && sel.startsWith(marker) && sel.endsWith(marker)) {
    const inner = sel.slice(n, -n);
    return { next: before + inner + after, selStart: start, selEnd: start + inner.length };
  }
  return {
    next: `${before}${marker}${sel}${marker}${after}`,
    selStart: start + n,
    selEnd: end + n,
  };
}

export function RichTextTextarea({ value, onChange, toolbarExtra, toolbarStyle, style, ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function apply(kind: keyof typeof WRAPPERS) {
    const el = ref.current;
    if (!el) return;
    const { next, selStart, selEnd } = toggleWrap(value, el.selectionStart, el.selectionEnd, WRAPPERS[kind]);
    onChange(next);
    // 상태 반영 뒤 선택을 복원해야 연속 편집이 끊기지 않는다.
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(selStart, selEnd);
    });
  }

  const btn: CSSProperties = {
    minWidth: 26,
    height: 24,
    padding: '0 6px',
    fontSize: 12,
    lineHeight: 1,
    cursor: 'pointer',
    border: '1px solid var(--border, #d4d4d8)',
    borderRadius: 4,
    background: 'var(--surface, #fff)',
    color: 'var(--text, inherit)',
  };

  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', ...toolbarStyle }}>
        <button type="button" style={{ ...btn, fontWeight: 800 }} onClick={() => apply('bold')} title="굵게 (Ctrl+B)" aria-label="굵게">
          B
        </button>
        <button type="button" style={{ ...btn, fontStyle: 'italic' }} onClick={() => apply('italic')} title="기울임 (Ctrl+I)" aria-label="기울임">
          I
        </button>
        {toolbarExtra ? <div style={{ marginLeft: 'auto' }}>{toolbarExtra}</div> : null}
      </div>
      <textarea
        {...rest}
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (!(e.ctrlKey || e.metaKey)) return;
          const k = e.key.toLowerCase();
          if (k !== 'b' && k !== 'i') return;
          e.preventDefault();
          apply(k === 'b' ? 'bold' : 'italic');
        }}
        style={style}
      />
    </div>
  );
}
