export type ParsedRange = {
  min: number | null;
  max: number | null;
};

/**
 * reference_range 텍스트를 min/max 숫자로 파싱합니다.
 * "10.0 - 20.0", "10~20", "10 — 20", "<5.0", ">100" 등 지원.
 */
export function parseReferenceRange(raw: string | null | undefined): ParsedRange {
  if (!raw?.trim()) return { min: null, max: null };
  const t = raw.trim();

  const rangeMatch = t.match(/^([<>]?\s*\d+(?:[.,]\d+)?)\s*[-–—~]\s*(\d+(?:[.,]\d+)?)$/);
  if (rangeMatch) {
    return {
      min: parseFloat(rangeMatch[1].replace(',', '.')),
      max: parseFloat(rangeMatch[2].replace(',', '.')),
    };
  }

  const ltMatch = t.match(/^<\s*(\d+(?:[.,]\d+)?)$/);
  if (ltMatch) {
    return { min: null, max: parseFloat(ltMatch[1].replace(',', '.')) };
  }

  const gtMatch = t.match(/^>\s*(\d+(?:[.,]\d+)?)$/);
  if (gtMatch) {
    return { min: parseFloat(gtMatch[1].replace(',', '.')), max: null };
  }

  return { min: null, max: null };
}

export function valuePositionPercent(
  valueText: string | null | undefined,
  range: ParsedRange,
): number | null {
  if (!valueText?.trim()) return null;
  const val = parseFloat(valueText.replace(',', '.'));
  if (Number.isNaN(val)) return null;
  if (range.min == null && range.max == null) return null;

  const rMin = range.min ?? 0;
  const rMax = range.max ?? rMin * 2;
  const span = rMax - rMin;
  if (span <= 0) return null;

  const pct = ((val - rMin) / span) * 100;
  return Math.max(-10, Math.min(110, pct));
}
