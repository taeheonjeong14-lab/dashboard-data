export function joinTimelineCardText(cardTitle: string, cardBody: string): string {
  // 편집 중 공백(스페이스)이 즉시 잘려나가지 않도록 원문을 보존한다(trim 금지).
  // 제목/본문 둘 다 비었으면 빈 문자열로 저장 — 자동 기본값을 채우지 않는다.
  const title = cardTitle ?? '';
  const body = cardBody ?? '';
  if (!title.trim() && !body.trim()) return '';
  return `${title}\n${body}`;
}

export function splitTimelineCardText(raw: string): { cardTitle: string; cardBody: string } {
  // slice 결과를 trim 하지 않는다(후행 공백 보존 → 편집 중 스페이스 유지).
  const s = raw ?? '';
  if (!s.trim()) return { cardTitle: '', cardBody: '' };
  const nl = s.indexOf('\n');
  if (nl === -1) return { cardTitle: '', cardBody: s };
  return { cardTitle: s.slice(0, nl), cardBody: s.slice(nl + 1) };
}
