const DEFAULT_RECHECK_TITLE = '재검 권장';
const DEFAULT_RECHECK_BODY = '재검 일정을 확인해 주시기 바랍니다.';

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
  // 내용이 비었을(공백뿐일) 때에만 기본값으로 대체한다.
  const title = (cardTitle ?? '').trim() ? (cardTitle ?? '') : DEFAULT_RECHECK_TITLE;
  const body = (cardBody ?? '').trim() ? (cardBody ?? '') : DEFAULT_RECHECK_BODY;
  return `${title}\n${body}`;
}
