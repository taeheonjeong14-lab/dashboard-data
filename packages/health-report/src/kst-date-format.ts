const ISO_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `coverCheckupDate` 저장값을 `<input type="date">` 값으로.
 * `YYYY-MM-DD` 또는 `yyyy년 m월 d일` 형태만 인식, 그 외는 빈 문자열.
 */
export function coverCheckupDateToIsoInputValue(raw: string | undefined): string {
  const t = (raw ?? '').trim();
  if (!t) return '';
  if (ISO_DATE_ONLY.test(t)) return t;
  const m = t.match(/^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*$/);
  if (m) {
    const y = m[1];
    const mo = m[2].padStart(2, '0');
    const d = m[3].padStart(2, '0');
    return `${y}-${mo}-${d}`;
  }
  return '';
}

/**
 * 보고서·미리보기용 한 줄 날짜. `YYYY-MM-DD`면 KST 해당 일의 `yyyy년 mm월 dd일`, 아니면 trim 한 문자열 그대로.
 */
export function formatCoverCheckupDateForReport(raw: string | undefined): string | undefined {
  const t = (raw ?? '').trim();
  if (!t) return undefined;
  if (ISO_DATE_ONLY.test(t)) {
    return formatKoreanShortDateKst(new Date(`${t}T12:00:00+09:00`));
  }
  return t;
}

/** Asia/Seoul 달력 기준 `yyyy년 mm월 dd일` (보고서 날짜 표기) */
export function formatKoreanShortDateKst(instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(instant);
  const y = parts.find((p) => p.type === 'year')?.value ?? '0';
  const m = Number(parts.find((p) => p.type === 'month')?.value ?? 1);
  const d = Number(parts.find((p) => p.type === 'day')?.value ?? 1);
  const mm = String(m).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return `${y}년 ${mm}월 ${dd}일`;
}
