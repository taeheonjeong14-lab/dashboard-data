/** Calendar math and buckets use explicit Y-M-D (proleptic Gregorian). */

import type { HospitalManagementDayRow } from "@/lib/queries";

export type ManagementMetricKey = "sales" | "visits" | "newPatients";

export type ManagementDayRow = HospitalManagementDayRow;

export type Granularity = "day" | "month" | "year";

function rowMatchesGranularity(row: ManagementDayRow, granularity: Granularity): boolean {
  return row.periodType === granularity;
}

export function pickMetric(row: ManagementDayRow, metric: ManagementMetricKey): number | null {
  switch (metric) {
    case "sales":
      return row.sales;
    case "visits":
      return row.visits;
    case "newPatients":
      return row.newPatients;
    default:
      return null;
  }
}

/** Monday = 0, Sunday = 6 */
export function weekdayMonday0FromDateKey(dateKey: string): number {
  const [ys, ms, ds] = dateKey.split("-").map(Number);
  const dow = new Date(Date.UTC(ys, ms - 1, ds)).getUTCDay();
  return (dow + 6) % 7;
}

export function yearMonthFromDateKey(dateKey: string): string {
  return dateKey.slice(0, 7);
}

export function addCalendarMonths(ym: string, delta: number): string {
  const [ys, ms] = ym.split("-").map(Number);
  let y = ys;
  let m = ms + delta;
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  while (m < 1) {
    m += 12;
    y -= 1;
  }
  return `${y}-${String(m).padStart(2, "0")}`;
}

function getRowsForGranularity(rows: ManagementDayRow[], granularity: Granularity): ManagementDayRow[] {
  return rows
    .filter((r) => rowMatchesGranularity(r, granularity))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

export function getDataBounds(rows: ManagementDayRow[]): { min: string; max: string } | null {
  // year/month 집계 row 는 dateKey 가 해/월의 1일로 강제되므로,
  // "전체" 범위가 실제 첫 데이터보다 앞서 보이는 문제를 막기 위해 day row 만 기준.
  const dayRows = rows.filter((r) => r.periodType === "day");
  const source = dayRows.length > 0 ? dayRows : rows;
  if (source.length === 0) return null;
  const sorted = [...source].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  return { min: sorted[0].dateKey, max: sorted[sorted.length - 1].dateKey };
}

export type SeriesChartPoint = {
  label: string;
  sortKey: string;
  value: number | null;
};

function addDaysToDateKey(dateKey: string, delta: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + delta * 86400000;
  const dt = new Date(t);
  const ys = dt.getUTCFullYear();
  const mo = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const da = String(dt.getUTCDate()).padStart(2, "0");
  return `${ys}-${mo}-${da}`;
}

export function buildAggregatedSeries(
  rows: ManagementDayRow[],
  rangeStart: string,
  rangeEnd: string,
  granularity: Granularity,
  metric: ManagementMetricKey
): SeriesChartPoint[] {
  if (granularity === "day") {
    const dayRows = getRowsForGranularity(rows, "day");
    const byDate = new Map(dayRows.map((r) => [r.dateKey, pickMetric(r, metric)]));
    const points: SeriesChartPoint[] = [];
    for (let d = rangeStart; d <= rangeEnd; d = addDaysToDateKey(d, 1)) {
      points.push({
        label: d.slice(5).replace("-", "/"),
        sortKey: d,
        value: byDate.get(d) ?? null,
      });
    }
    return points;
  }
  if (granularity === "month") {
    const monthRows = getRowsForGranularity(rows, "month");
    const byMonth = new Map(
      monthRows.map((r) => [yearMonthFromDateKey(r.dateKey), pickMetric(r, metric)])
    );
    const startYm = yearMonthFromDateKey(rangeStart);
    const endYm = yearMonthFromDateKey(rangeEnd);
    const points: SeriesChartPoint[] = [];
    for (let ym = startYm; ym <= endYm; ym = addCalendarMonths(ym, 1)) {
      points.push({
        label: ym,
        sortKey: ym,
        value: byMonth.get(ym) ?? null,
      });
    }
    return points;
  }
  const yearRows = getRowsForGranularity(rows, "year");
  const byYear = new Map(yearRows.map((r) => [r.dateKey.slice(0, 4), pickMetric(r, metric)]));
  const startYear = Number(rangeStart.slice(0, 4));
  const endYear = Number(rangeEnd.slice(0, 4));
  const points: SeriesChartPoint[] = [];
  for (let y = startYear; y <= endYear; y++) {
    const key = String(y);
    points.push({
      label: `${y}년`,
      sortKey: key,
      value: byYear.get(key) ?? null,
    });
  }
  return points;
}

export type YoYMonthRow = {
  monthKey: string;
  monthLabel: string;
  recentValue: number | null;
  previousValue: number | null;
};

export function buildYoYMonthlyRows(
  rows: ManagementDayRow[],
  metric: ManagementMetricKey
): YoYMonthRow[] {
  const monthRows = getRowsForGranularity(rows, "month");
  if (monthRows.length === 0) return [];
  const byMonth = new Map(
    monthRows.map((r) => [yearMonthFromDateKey(r.dateKey), pickMetric(r, metric)])
  );
  const dayRows = getRowsForGranularity(rows, "day");
  const anchorDateKey =
    dayRows.length > 0
      ? dayRows[dayRows.length - 1].dateKey
      : monthRows[monthRows.length - 1].dateKey;
  const endYm = addCalendarMonths(yearMonthFromDateKey(anchorDateKey), -1);
  const months: string[] = [];
  for (let i = 0; i < 12; i++) months.push(addCalendarMonths(endYm, -11 + i));
  return months.map((ym) => ({
    monthKey: ym,
    monthLabel: `${Number(ym.slice(5, 7))}월`,
    recentValue: byMonth.get(ym) ?? null,
    previousValue: byMonth.get(addCalendarMonths(ym, -12)) ?? null,
  }));
}

export type WeekdayRow = {
  weekdayIndex: number;
  weekdayLabel: string;
  avgLast12Months: number | null;
  last7DayValue: number | null;
  recentDateKey: string | null;
};

const WEEKDAY_LABELS = ["월요일", "화요일", "수요일", "목요일", "금요일", "토요일", "일요일"] as const;

function parseDateKeyAsUtc(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function last7DateKeys(endDateKey: string): string[] {
  const end = parseDateKeyAsUtc(endDateKey);
  const keys: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const t = new Date(end - i * 86400000);
    const y = t.getUTCFullYear();
    const mo = String(t.getUTCMonth() + 1).padStart(2, "0");
    const da = String(t.getUTCDate()).padStart(2, "0");
    keys.push(`${y}-${mo}-${da}`);
  }
  return keys;
}

export function buildWeekdayRows(
  rows: ManagementDayRow[],
  metric: ManagementMetricKey
): WeekdayRow[] {
  const dayRows = getRowsForGranularity(rows, "day");
  if (dayRows.length === 0) {
    return WEEKDAY_LABELS.map((label, weekdayIndex) => ({
      weekdayIndex,
      weekdayLabel: label,
      avgLast12Months: null,
      last7DayValue: null,
      recentDateKey: null,
    }));
  }

  const byDate = new Map(dayRows.map((r) => [r.dateKey, r]));
  const endDateKey = dayRows[dayRows.length - 1].dateKey;
  const endYm = yearMonthFromDateKey(endDateKey);
  const windowMonths = new Set<string>();
  for (let i = 0; i < 12; i++) windowMonths.add(addCalendarMonths(endYm, -11 + i));

  const sumsByWeekday = [0, 0, 0, 0, 0, 0, 0];
  const countsByWeekday = [0, 0, 0, 0, 0, 0, 0];
  for (const r of dayRows) {
    if (!windowMonths.has(yearMonthFromDateKey(r.dateKey))) continue;
    const wd = weekdayMonday0FromDateKey(r.dateKey);
    const v = pickMetric(r, metric);
    if (v != null && Number.isFinite(v)) {
      sumsByWeekday[wd] += v;
      countsByWeekday[wd] += 1;
    }
  }

  const last7 = last7DateKeys(endDateKey);
  const last7ByWeekday: (number | null)[] = [null, null, null, null, null, null, null];
  const dateByWeekday: (string | null)[] = [null, null, null, null, null, null, null];
  for (const dk of last7) {
    const row = byDate.get(dk);
    const wd = weekdayMonday0FromDateKey(dk);
    last7ByWeekday[wd] = row ? pickMetric(row, metric) : null;
    dateByWeekday[wd] = dk;
  }

  return WEEKDAY_LABELS.map((label, weekdayIndex) => ({
    weekdayIndex,
    weekdayLabel: label,
    avgLast12Months:
      countsByWeekday[weekdayIndex] > 0
        ? sumsByWeekday[weekdayIndex] / countsByWeekday[weekdayIndex]
        : null,
    last7DayValue: last7ByWeekday[weekdayIndex],
    recentDateKey: dateByWeekday[weekdayIndex],
  }));
}
