/** 블로그 추이 차트 전용 집계 helper. trend-only(추이 라인차트만) 용도. */

import type { BlogPeriodDayRow } from "./types";

export type BlogMetricKey = "views" | "uniqueVisitors";

export type Granularity = "day" | "month" | "year";

export type BlogSeriesPoint = {
  label: string;
  sortKey: string;
  value: number | null;
};

export function pickBlogMetric(row: BlogPeriodDayRow, metric: BlogMetricKey): number | null {
  switch (metric) {
    case "views":
      return row.views;
    case "uniqueVisitors":
      return row.uniqueVisitors;
    default:
      return null;
  }
}

function getRowsForGranularity(
  rows: BlogPeriodDayRow[],
  granularity: Granularity
): BlogPeriodDayRow[] {
  return rows
    .filter((r) => r.periodType === granularity)
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

export function getDataBounds(rows: BlogPeriodDayRow[]): { min: string; max: string } | null {
  // year/month 집계 row 는 dateKey 가 해/월의 1일로 강제되므로 day row 만 기준.
  const dayRows = rows.filter((r) => r.periodType === "day");
  const source = dayRows.length > 0 ? dayRows : rows;
  if (source.length === 0) return null;
  const sorted = [...source].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  return { min: sorted[0].dateKey, max: sorted[sorted.length - 1].dateKey };
}

function yearMonthFromDateKey(dateKey: string): string {
  return dateKey.slice(0, 7);
}

function addCalendarMonths(ym: string, delta: number): string {
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

function addDaysToDateKey(dateKey: string, delta: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + delta * 86400000;
  const dt = new Date(t);
  const ys = dt.getUTCFullYear();
  const mo = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const da = String(dt.getUTCDate()).padStart(2, "0");
  return `${ys}-${mo}-${da}`;
}

export function buildBlogSeries(
  rows: BlogPeriodDayRow[],
  rangeStart: string,
  rangeEnd: string,
  granularity: Granularity,
  metric: BlogMetricKey
): BlogSeriesPoint[] {
  if (granularity === "day") {
    const dayRows = getRowsForGranularity(rows, "day");
    const byDate = new Map(dayRows.map((r) => [r.dateKey, pickBlogMetric(r, metric)]));
    const points: BlogSeriesPoint[] = [];
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
      monthRows.map((r) => [yearMonthFromDateKey(r.dateKey), pickBlogMetric(r, metric)])
    );
    const startYm = yearMonthFromDateKey(rangeStart);
    const endYm = yearMonthFromDateKey(rangeEnd);
    const points: BlogSeriesPoint[] = [];
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
  const byYear = new Map(
    yearRows.map((r) => [r.dateKey.slice(0, 4), pickBlogMetric(r, metric)])
  );
  const startYear = Number(rangeStart.slice(0, 4));
  const endYear = Number(rangeEnd.slice(0, 4));
  const points: BlogSeriesPoint[] = [];
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

export function addDaysFromDateKey(dateKey: string, delta: number): string {
  return addDaysToDateKey(dateKey, delta);
}
