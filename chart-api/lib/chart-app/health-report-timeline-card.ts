export function splitTimelineCardText(raw: string): { cardTitle: string; cardBody: string } {
  const t = raw ?? '';
  if (!t.trim()) return { cardTitle: '', cardBody: '' };
  const nl = t.indexOf('\n');
  if (nl === -1) return { cardTitle: '', cardBody: t };
  const title = t.slice(0, nl);
  const body = t.slice(nl + 1);
  return { cardTitle: title, cardBody: body };
}

export function joinTimelineCardText(cardTitle: string, cardBody: string): string {
  // 편집 중 공백(스페이스)이 즉시 잘려나가지 않도록 원문을 보존한다(trim 금지).
  // 제목/본문 둘 다 비었으면 빈 문자열로 저장 — 자동 기본값을 채우지 않는다.
  const title = cardTitle ?? '';
  const body = cardBody ?? '';
  if (!title.trim() && !body.trim()) return '';
  return `${title}\n${body}`;
}
