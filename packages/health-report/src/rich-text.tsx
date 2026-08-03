/**
 * 리포트 본문의 **볼드**·*이탤릭* 만 지원하는 최소 마크다운.
 *
 * 왜 마크다운 라이트인가:
 *  - 저장 형식이 계속 **평문**이라 DB·LLM 파이프라인·기존 데이터가 그대로다. 서식이 필요 없으면
 *    아무 일도 일어나지 않는다.
 *  - 화면과 PDF가 같은 React 렌더를 타므로 인쇄본에도 자동으로 반영된다.
 *  - HTML 을 만들지 않고 **React 노드로 변환**한다 — dangerouslySetInnerHTML 을 쓰지 않으므로
 *    본문에 우연히 들어간 <script> 나 태그 문자열이 마크업으로 해석될 여지가 없다.
 *
 * 파싱을 일부러 좁게 잡았다. 본문 상당 부분이 LLM 생성물이라, 규칙이 넓으면 의도치 않은 별표가
 * 서식으로 둔갑한다. 그래서:
 *  - `**볼드**` 는 쌍이 맞을 때만. 짝이 없으면 별표를 **그대로 글자로** 남긴다.
 *  - `*이탤릭*` 은 안쪽이 공백으로 시작/끝나지 않을 때만(예: `3 * 4 * 5` 는 서식이 아니다).
 *  - 줄바꿈은 건드리지 않는다 — 기존처럼 CSS `white-space: pre-wrap` 이 처리한다.
 */
import type { ReactNode } from 'react';

/**
 * `***…***`(굵게+기울임) → `**…**`(굵게) 순으로 먹고, 남은 조각에서 `*…*`(기울임)를 찾는다.
 *
 * 세 겹을 먼저 잡는 게 중요하다. `**` 규칙만 두면 `***둘다***` 에서 앞의 `**` 와 뒤쪽 `**` 가
 * 짝지어져 `<strong>*둘다</strong>*` 처럼 별표가 본문에 새어나온다. 편집기에서 한 글자에
 * 굵게·기울임을 다 걸면 실제로 `***…***` 가 만들어지므로 반드시 처리해야 한다.
 */
const BOLD = /\*\*\*([^\n]+?)\*\*\*|\*\*([^\n]+?)\*\*/;
const ITALIC = /(?<![*\w])\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\*)/;

function renderItalic(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let i = 0;
  for (;;) {
    const m = ITALIC.exec(rest);
    if (!m || m.index === undefined) break;
    if (m.index > 0) out.push(rest.slice(0, m.index));
    out.push(<em key={`${keyPrefix}i${i}`}>{m[1]}</em>);
    rest = rest.slice(m.index + m[0].length);
    i += 1;
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * 평문을 React 노드로. 서식 문자가 없으면 입력 문자열을 그대로 돌려준다(불필요한 래핑 없음).
 * 문자열이 아니면(이미 노드면) 그대로 통과시킨다 — 호출부가 조건 분기를 하지 않아도 되게.
 */
export function renderReportRichText(value: unknown): ReactNode {
  if (typeof value !== 'string') return (value ?? null) as ReactNode;
  if (!value.includes('*')) return value;

  const out: ReactNode[] = [];
  let rest = value;
  let i = 0;
  for (;;) {
    const m = BOLD.exec(rest);
    if (!m || m.index === undefined) break;
    if (m.index > 0) out.push(...renderItalic(rest.slice(0, m.index), `b${i}pre`));
    out.push(
      m[1] !== undefined ? (
        // `***x***` — 굵게 안에 기울임. 안쪽을 다시 파싱하지 않는다(이미 둘 다 걸린 상태다).
        <strong key={`b${i}`}>
          <em>{m[1]}</em>
        </strong>
      ) : (
        <strong key={`b${i}`}>{renderItalic(m[2] ?? '', `b${i}in`)}</strong>
      ),
    );
    rest = rest.slice(m.index + m[0].length);
    i += 1;
  }
  if (rest) out.push(...renderItalic(rest, `tail`));
  return out.length === 1 ? out[0] : out;
}
