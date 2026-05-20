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
  const rawTitle = (cardTitle ?? '').trim();
  const rawBody = (cardBody ?? '').trim();
  const title = rawTitle || DEFAULT_RECHECK_TITLE;
  const body = rawBody || DEFAULT_RECHECK_BODY;
  return `${title}\n${body}`;
}
