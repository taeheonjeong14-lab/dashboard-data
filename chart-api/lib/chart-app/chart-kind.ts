/** vet-report `lib/text-bucketing/chart-kind.ts` 와 동일 집합 */
export type ChartKind = 'intovet' | 'plusvet' | 'other' | 'efriends' | 'woorien_pms';

export function parseChartKind(raw: unknown): ChartKind | null {
  if (raw === 'plusvet' || raw === 'other' || raw === 'intovet' || raw === 'efriends' || raw === 'woorien_pms') return raw;
  return null;
}
