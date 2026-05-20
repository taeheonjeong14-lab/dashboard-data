const DEFAULT_RECHECK_TITLE = '재검 권장';
const DEFAULT_RECHECK_BODY = '재검 일정을 확인해 주시기 바랍니다.';

export function joinTimelineCardText(cardTitle: string, cardBody: string): string {
  // 편집 중 공백(스페이스)이 즉시 잘려나가지 않도록 원문을 보존한다(trim 금지).
  // 내용이 비었을(공백뿐일) 때에만 기본값으로 대체한다.
  const title = (cardTitle ?? '').trim() ? (cardTitle ?? '') : DEFAULT_RECHECK_TITLE;
  const body = (cardBody ?? '').trim() ? (cardBody ?? '') : DEFAULT_RECHECK_BODY;
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
