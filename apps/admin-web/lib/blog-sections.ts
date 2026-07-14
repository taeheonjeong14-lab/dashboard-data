/**
 * 블로그 글(마크다운) ↔ 섹션 배열 변환 — 3단계 편집기와 4단계 검수 편집기가 함께 쓴다.
 * 섹션 = "## 제목" 헤딩 하나와 그 아래 본문.
 */
export type BlogSection = { heading: string; body: string };

export function parseBlogSections(md: string): BlogSection[] {
  const out: BlogSection[] = [];
  let cur: BlogSection | null = null;
  for (const line of md.split('\n')) {
    const m = /^#{1,4}\s+(.*)$/.exec(line.trim());
    if (m) {
      if (cur) out.push(cur);
      cur = { heading: m[1].trim(), body: '' };
    } else {
      if (!cur) cur = { heading: '', body: '' };
      cur.body += (cur.body ? '\n' : '') + line;
    }
  }
  if (cur) out.push(cur);
  return out.filter((s) => s.heading || s.body.trim());
}

export function rebuildBlogMarkdown(sections: BlogSection[]): string {
  return sections
    .map((s) => [s.heading.trim() ? `## ${s.heading.trim()}` : '', s.body.trim()].filter(Boolean).join('\n\n'))
    .filter(Boolean)
    .join('\n\n');
}
