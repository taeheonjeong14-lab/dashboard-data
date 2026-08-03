'use client';

/**
 * 리포트 본문 편집기 — 워드처럼 **편집칸 안에서 굵게·기울임이 그대로 보인다**.
 *
 * 저장 형식은 계속 평문 마크다운(`**볼드**`, `*이탤릭*`)이다. 화면만 서식으로 보여주고
 * 밖으로는 평문을 내보내므로 DB·LLM 파이프라인·기존 데이터가 그대로다. 리포트 렌더도
 * 같은 평문을 renderReportRichText 로 그리니 편집칸과 결과물이 어긋나지 않는다.
 *
 * textarea 는 원리상 서식을 그릴 수 없어 contentEditable 을 쓴다. 그래서 조심할 게 셋 있다:
 *
 *  1. **한글 입력(IME)** — 조합 중에 값을 되돌리면 글자가 깨진다. composition 중에는 어떤
 *     동기화도 하지 않고, compositionend 에서 한 번만 내보낸다.
 *  2. **커서 튐** — React 가 innerHTML 을 다시 쓰면 커서가 맨 앞으로 간다. 그래서 이 컴포넌트는
 *     내부를 **비제어**로 두고, 밖에서 온 값이 우리가 마지막으로 내보낸 값과 다를 때만 다시 그린다
 *     (AI 재생성처럼 진짜 외부 변경일 때).
 *  3. **붙여넣기** — 워드·웹에서 복사하면 온갖 태그가 딸려온다. 평문으로만 받는다.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';

type Props = {
  value: string;
  onChange: (next: string) => void;
  /** 평문 기준 최대 글자수. 넘기는 입력은 되돌린다(textarea 의 maxLength 대체). */
  maxLength?: number;
  /** textarea 시절 rows 와 비슷한 최소 높이를 만든다(1행 ≈ 1.6em). */
  rows?: number;
  placeholder?: string;
  className?: string;
  style?: CSSProperties;
};

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ESC[c]);

/** 「1. 소제목」처럼 번호로 시작하는 줄 — 리포트가 자동으로 굵게 그리는 규칙(hrss-topic-num). */
const NUMBERED_LINE = /^\s*\d+\.\s/;

/**
 * 평문 마크다운 → 표시용 HTML. rich-text.tsx 의 렌더 규칙과 같은 좁은 규칙을 쓴다.
 *
 * 번호 소제목 줄은 저장된 텍스트에 별표가 없어도 리포트가 자동으로 굵게 그린다(종합소견·사후관리).
 * 편집칸이 그걸 안 보여주면 "리포트엔 굵은데 편집칸엔 안 굵은" 불일치가 생기므로 여기서도 같이 그린다.
 * 단 `<strong>` 이 아니라 `<span>` 으로 그린다 — htmlToMarkdown 이 span 은 껍데기로 보고 벗겨내므로
 * **자동 굵게가 별표로 저장에 새어 들어가지 않는다**. 새어 들어가면 리포트가 이중으로 굵게 처리하고,
 * 첫 글자가 `*` 가 되어 번호 규칙(NUMBERED_LINE)까지 깨진다.
 */
export function markdownToHtml(md: string): string {
  return (md ?? '')
    .split('\n')
    .map((line) => {
      const html = esc(line)
        .replace(/\*\*\*([^\n]+?)\*\*\*/g, '<strong><em>$1</em></strong>')
        .replace(/\*\*([^\n]+?)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\*)/g, '$1<em>$2</em>');
      return NUMBERED_LINE.test(line) ? `<span style="font-weight:700">${html}</span>` : html;
    })
    .join('<br>');
}

/** 표시용 HTML → 평문 마크다운. 굵게·기울임 외의 태그는 전부 버리고 글자만 남긴다. */
export function htmlToMarkdown(root: Node): string {
  let out = '';
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        out += child.textContent ?? '';
        continue;
      }
      if (!(child instanceof HTMLElement)) continue;
      const tag = child.tagName.toLowerCase();
      if (tag === 'br') {
        out += '\n';
        continue;
      }
      // 브라우저가 Enter 로 만든 블록. 앞에 줄바꿈을 넣고 안쪽을 잇는다.
      if (tag === 'div' || tag === 'p') {
        if (out && !out.endsWith('\n')) out += '\n';
        walk(child);
        continue;
      }
      const strong = tag === 'strong' || tag === 'b';
      const em = tag === 'em' || tag === 'i';
      if (strong || em) {
        const marker = strong ? '**' : '*';
        const before = out.length;
        walk(child);
        const inner = out.slice(before);
        // 빈 서식은 마커만 남아 지저분해지므로 버린다.
        out = inner.trim() ? `${out.slice(0, before)}${marker}${inner}${marker}` : out.slice(0, before);
        continue;
      }
      walk(child); // span 등 나머지는 껍데기를 버리고 안쪽만
    }
  };
  walk(root);
  return out;
}

const btnBase: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  height: 26,
  padding: '0 9px',
  fontSize: 12,
  lineHeight: 1,
  cursor: 'pointer',
  border: '1px solid var(--border, #d4d4d8)',
  borderRadius: 5,
  background: 'var(--surface, #fff)',
  color: 'var(--text, inherit)',
};

export function RichTextTextarea({ value, onChange, maxLength, rows, placeholder, className, style }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  /** 우리가 마지막으로 밖에 내보낸 평문. 외부 변경과 자기 입력을 구분하는 기준. */
  const emitted = useRef<string | null>(null);
  const [empty, setEmpty] = useState(!value);

  // 외부에서 값이 바뀐 경우에만 다시 그린다(자기 입력이면 건드리지 않아 커서가 유지된다).
  useEffect(() => {
    const el = ref.current;
    if (!el || composing.current) return;
    if (value === emitted.current) return;
    el.innerHTML = markdownToHtml(value ?? '');
    emitted.current = value ?? '';
    setEmpty(!value);
  }, [value]);

  function flush() {
    const el = ref.current;
    if (!el) return;
    const md = htmlToMarkdown(el);
    if (maxLength != null && md.length > maxLength) {
      // 한도를 넘으면 되돌린다. contentEditable 에는 maxLength 가 없다.
      el.innerHTML = markdownToHtml(emitted.current ?? '');
      return;
    }
    emitted.current = md;
    setEmpty(!md);
    onChange(md);
  }

  function exec(cmd: 'bold' | 'italic') {
    ref.current?.focus();
    // execCommand 는 폐기 예정이지만 contentEditable 의 굵게/기울임에서는 여전히 모든 브라우저가
    // 지원하고, 직접 Range 를 쪼개는 것보다 훨씬 안전하다(선택이 태그를 걸칠 때가 특히).
    document.execCommand(cmd);
    flush();
  }

  const minHeight = rows ? Math.round(rows * 1.6 * 14) : undefined;

  return (
    <div style={{ display: 'grid', gap: 5 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" style={btnBase} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('bold')}>
          <b style={{ fontSize: 13 }}>B</b> 굵게
        </button>
        <button type="button" style={btnBase} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('italic')}>
          <i style={{ fontSize: 13, fontFamily: 'serif' }}>I</i> 기울임
        </button>
        <span style={{ fontSize: 11, color: 'var(--text-muted, #71717a)' }}>선택 후 클릭 · Ctrl+B / Ctrl+I</span>
      </div>

      <div style={{ position: 'relative' }}>
        <div
          ref={ref}
          className={className}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          onInput={() => { if (!composing.current) flush(); }}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={() => { composing.current = false; flush(); }}
          onBlur={() => {
            // 타이핑 중에는 커서를 지키려고 다시 그리지 않는다. 그래서 새로 친 「2. 소제목」 줄의
            // 자동 굵게가 바로 반영되지 않는데, 포커스가 빠지는 시점엔 커서 걱정이 없으니 여기서 맞춘다.
            const el = ref.current;
            if (el && !composing.current) el.innerHTML = markdownToHtml(emitted.current ?? '');
          }}
          onPaste={(e) => {
            // 워드·웹에서 복사하면 태그가 딸려온다. 글자만 받는다.
            e.preventDefault();
            const text = e.clipboardData.getData('text/plain');
            document.execCommand('insertText', false, text);
          }}
          onKeyDown={(e) => {
            if (!(e.ctrlKey || e.metaKey)) return;
            const k = e.key.toLowerCase();
            if (k !== 'b' && k !== 'i') return;
            e.preventDefault();
            exec(k === 'b' ? 'bold' : 'italic');
          }}
          style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowY: 'auto', minHeight, ...style }}
        />
        {empty && placeholder ? (
          <span
            aria-hidden
            style={{
              position: 'absolute',
              top: (style?.padding as number) ?? 8,
              left: (style?.padding as number) ?? 8,
              fontSize: style?.fontSize ?? 14,
              color: 'var(--text-muted, #a1a1aa)',
              pointerEvents: 'none',
            }}
          >
            {placeholder}
          </span>
        ) : null}
      </div>
    </div>
  );
}
