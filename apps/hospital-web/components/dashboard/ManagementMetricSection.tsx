"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { HospitalManagementDayRow } from "@/lib/queries";
import {
  buildAggregatedSeries,
  buildWeekdayRows,
  buildYoYMonthlyRows,
  getDataBounds,
  type Granularity,
  type ManagementMetricKey,
  weekdayMonday0FromDateKey,
} from "@/lib/management-aggregates";

const tooltipStyle = {
  backgroundColor: "#ffffff",
  border: "1px solid #e5e8eb",
  borderRadius: "8px",
};

const BAR_COLORS = {
  current: "#3182F6",
  previous: "#4b5563",
} as const;

function clipRange(
  start: string,
  end: string,
  minBound: string,
  maxBound: string
): { start: string; end: string } {
  let s = start < minBound ? minBound : start;
  let e = end > maxBound ? maxBound : end;
  if (s > e) {
    s = minBound;
    e = maxBound;
  }
  return { start: s, end: e };
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

function formatYmLabel(ym: string) {
  const [y, m] = ym.split("-");
  return `${y}년 ${Number(m)}월`;
}

function formatMonthOnly(ym: string) {
  return `${Number(ym.slice(5, 7))}월`;
}

const KOREAN_WEEKDAYS = [
  "월요일",
  "화요일",
  "수요일",
  "목요일",
  "금요일",
  "토요일",
  "일요일",
] as const;

function formatDateWithWeekday(dateKey: string | null): string {
  if (!dateKey) return "날짜 데이터 없음";
  const [y, m, d] = dateKey.split("-").map(Number);
  const wd = KOREAN_WEEKDAYS[weekdayMonday0FromDateKey(dateKey)];
  return `${y}년 ${m}월 ${d}일 (${wd})`;
}

export type ManagementMetricSectionProps = {
  title: string;
  description?: string;
  rows: HospitalManagementDayRow[];
  metric: ManagementMetricKey;
  valueFormat: "currency" | "integer" | "decimal";
  /** currency가 아닐 때 단위 (예: 건, 명) */
  valueSuffix?: string;
};

function formatValue(
  format: ManagementMetricSectionProps["valueFormat"],
  v: number | null,
  suffix?: string
): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (format === "currency") {
    return `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(v)}원`;
  }
  if (format === "integer") {
    const u = suffix ?? "건";
    return `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(v)}${u}`;
  }
  const u = suffix ?? "";
  return `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 }).format(v)}${u}`;
}

function formatAxis(format: ManagementMetricSectionProps["valueFormat"], v: number) {
  if (!Number.isFinite(v)) return "";
  if (format === "currency") {
    return new Intl.NumberFormat("ko-KR", {
      notation: v >= 1_000_000 ? "compact" : "standard",
      maximumFractionDigits: v >= 1_000_000 ? 1 : 0,
    }).format(v);
  }
  if (format === "integer") {
    return new Intl.NumberFormat("ko-KR", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(v);
  }
  return new Intl.NumberFormat("ko-KR", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(v);
}

export default function ManagementMetricSection({
  title,
  description,
  rows,
  metric,
  valueFormat,
  valueSuffix,
}: ManagementMetricSectionProps) {
  const bounds = useMemo(() => getDataBounds(rows), [rows]);
  const [granularity, setGranularity] = useState<Granularity>("month");
  const [rangeStart, setRangeStart] = useState<string>("");
  const [rangeEnd, setRangeEnd] = useState<string>("");

  const effectiveBounds = bounds ?? { min: "", max: "" };
  const minB = effectiveBounds.min;
  const maxB = effectiveBounds.max;
  const maxSelectable = maxB;

  const start = rangeStart || minB;
  const end = rangeEnd || maxSelectable;
  const clipped = useMemo(
    () =>
      minB && maxSelectable
        ? clipRange(start, end, minB, maxSelectable)
        : { start: "", end: "" },
    [start, end, minB, maxSelectable]
  );

  const chartData = useMemo(() => {
    if (!clipped.start || !clipped.end || rows.length === 0) return [];
    return buildAggregatedSeries(rows, clipped.start, clipped.end, granularity, metric);
  }, [rows, clipped, granularity, metric]);

  const stats = useMemo(() => {
    const values = chartData
      .map((p) => p.value)
      .filter((v): v is number => v != null && Number.isFinite(v));
    if (values.length === 0) return null;
    let min = values[0];
    let max = values[0];
    let sum = 0;
    for (const v of values) {
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
    }
    return { min, max, avg: sum / values.length };
  }, [chartData]);

  const yoyRows = useMemo(() => buildYoYMonthlyRows(rows, metric), [rows, metric]);
  const weekdayRows = useMemo(() => buildWeekdayRows(rows, metric), [rows, metric]);

  const setPreset = (preset: "all" | "1y" | "3y") => {
    if (!bounds) return;
    if (preset === "all") {
      setRangeStart(bounds.min);
      setRangeEnd(bounds.max);
      return;
    }
    const years = preset === "1y" ? 1 : 3;
    const from = addDaysToDateKey(bounds.max, -years * 365);
    setRangeStart(from < bounds.min ? bounds.min : from);
    setRangeEnd(bounds.max);
  };

  const hasData = rows.length > 0 && bounds != null;

  return (
    <section>
      <header className="mb-4">
        <h2 className="text-base font-semibold text-[var(--text)] sm:text-lg">{title}</h2>
        {description ? <p className="mt-1 text-sm text-[var(--text-muted)]">{description}</p> : null}
      </header>

      {!hasData ? (
        <p className="border border-[var(--border)] bg-[var(--bg)] p-4 text-sm text-[var(--text-muted)]">
          표시할 데이터가 없습니다.
        </p>
      ) : (
        <div className="flex flex-col gap-8">
          <div>
            <h3 className="mb-2 text-sm font-medium text-[var(--text-secondary)]">{title} 추이</h3>
            <div className="mb-3 flex flex-wrap items-end gap-3">
              <div className="flex flex-wrap gap-2">
                <label className="flex flex-col gap-0.5 text-xs text-[var(--text-muted)]">
                  시작
                  <input
                    type="date"
                    className="h-8 border border-[var(--border-strong)] bg-[var(--bg)] px-2 text-xs text-[var(--text)]"
                    min={minB}
                    max={maxSelectable}
                    value={rangeStart || minB}
                    onChange={(e) => setRangeStart(e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-0.5 text-xs text-[var(--text-muted)]">
                  종료
                  <input
                    type="date"
                    className="h-8 border border-[var(--border-strong)] bg-[var(--bg)] px-2 text-xs text-[var(--text)]"
                    min={minB}
                    max={maxSelectable}
                    value={rangeEnd || maxSelectable}
                    onChange={(e) => setRangeEnd(e.target.value)}
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-1">
                {(
                  [
                    ["all", "전체"],
                    ["1y", "최근 1년"],
                    ["3y", "최근 3년"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setPreset(key)}
                    className="h-8 border border-[var(--border-strong)] bg-[var(--bg)] px-2.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]"
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="ml-auto flex rounded border border-[var(--border-strong)] p-0.5">
                {(
                  [
                    ["day", "일간"],
                    ["month", "월간"],
                    ["year", "연간"],
                  ] as const
                ).map(([g, label]) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGranularity(g)}
                    className={`px-2.5 py-1 text-xs ${
                      granularity === g
                        ? "bg-[var(--accent)] text-white"
                        : "text-[var(--text-secondary)] hover:text-[var(--text)]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {stats ? (
              <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <span className="text-[var(--text-muted)]">
                  최대 <span className="ml-1 font-medium text-[var(--text)]">{formatValue(valueFormat, stats.max, valueSuffix)}</span>
                </span>
                <span className="text-[var(--text-muted)]">
                  최소 <span className="ml-1 font-medium text-[var(--text)]">{formatValue(valueFormat, stats.min, valueSuffix)}</span>
                </span>
                <span className="text-[var(--text-muted)]">
                  평균 <span className="ml-1 font-medium text-[var(--text)]">{formatValue(valueFormat, stats.avg, valueSuffix)}</span>
                </span>
              </div>
            ) : null}
            <div className="h-[280px] w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={200}>
                <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 8, left: 4 }}>
                  <CartesianGrid stroke="#e5e8eb" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="label"
                    stroke="#d1d6db"
                    tick={{ fill: "#8b95a1", fontSize: 11 }}
                    interval="preserveStartEnd"
                    minTickGap={24}
                  />
                  <YAxis
                    stroke="#d1d6db"
                    tick={{ fill: "#8b95a1", fontSize: 11 }}
                    tickFormatter={(val) => formatAxis(valueFormat, Number(val))}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelStyle={{ color: "#191f28" }}
                    content={({ payload, label }) => {
                      const raw = payload?.[0]?.value;
                      const n =
                        typeof raw === "number"
                          ? raw
                          : typeof raw === "string"
                            ? Number(raw)
                            : NaN;
                      const text = formatValue(
                        valueFormat,
                        Number.isFinite(n) ? n : null,
                        valueSuffix
                      );
                      const pointSortKey = (payload?.[0]?.payload as { sortKey?: string } | undefined)?.sortKey;
                      const displayLabel =
                        granularity === "day" && pointSortKey
                          ? pointSortKey.replace(/-/g, "/")
                          : label;
                      return (
                        <div className="rounded border border-[var(--border-strong)] bg-white px-2.5 py-1.5 text-xs shadow-lg">
                          <p className="mb-1 text-[var(--text-secondary)]">{displayLabel}</p>
                          <p className="text-[var(--text)]">
                            값 <span className="text-[var(--text-secondary)]">{text}</span>
                          </p>
                        </div>
                      );
                    }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }}
                    formatter={(value) => (
                      <span style={{ color: "#4e5968" }}>{value}</span>
                    )}
                  />
                  {stats ? (
                    <ReferenceLine
                      y={stats.avg}
                      stroke="#94a3b8"
                      strokeWidth={1.5}
                      ifOverflow="extendDomain"
                      label={{
                        value: `평균 ${formatValue(valueFormat, stats.avg, valueSuffix)}`,
                        position: "insideTopRight",
                        fill: "#64748b",
                        fontSize: 11,
                      }}
                    />
                  ) : null}
                  <Line
                    type="monotone"
                    dataKey="value"
                    name={title}
                    stroke="#3182F6"
                    strokeWidth={2}
                    dot={
                      granularity === "day"
                        ? false
                        : { r: 3, fill: "#3182F6", strokeWidth: 0 }
                    }
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-1 text-xs italic text-[var(--text-muted)]">
              기간은 서울 기준 날짜이며, 차트에 값이 없는 구간은 선이 끊깁니다.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-medium text-[var(--text-secondary)]">
                전년 동월 대비 {title} 비교 분석 (월간, 최근 12개월)
              </h3>
              <div className="h-[320px] w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={200}>
                  <BarChart data={yoyRows} margin={{ top: 8, right: 12, bottom: 8, left: 4 }}>
                    <CartesianGrid stroke="#e5e8eb" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="monthLabel"
                      stroke="#d1d6db"
                      tick={{ fill: "#8b95a1", fontSize: 11 }}
                      interval="preserveStartEnd"
                      minTickGap={24}
                    />
                    <YAxis
                      stroke="#d1d6db"
                      tick={{ fill: "#8b95a1", fontSize: 11 }}
                      tickFormatter={(val) => formatAxis(valueFormat, Number(val))}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      labelStyle={{ color: "#191f28" }}
                      content={({ payload }) => {
                        const row = payload?.[0]?.payload as
                          | {
                              monthKey?: string;
                              recentValue?: number | null;
                              previousValue?: number | null;
                            }
                          | undefined;
                        const ym = row?.monthKey;
                        if (!ym) return null;
                        const previousYm = `${Number(ym.slice(0, 4)) - 1}${ym.slice(4)}`;
                        const recentText = formatValue(
                          valueFormat,
                          row?.recentValue ?? null,
                          valueSuffix
                        );
                        const previousText = formatValue(
                          valueFormat,
                          row?.previousValue ?? null,
                          valueSuffix
                        );
                        return (
                          <div className="rounded border border-[var(--border-strong)] bg-white px-2.5 py-1.5 text-xs shadow-lg">
                            <p className="mb-1 text-[var(--text-secondary)]">{formatMonthOnly(ym)}</p>
                            <p className="text-[var(--text)]">
                              {formatYmLabel(ym)}: {recentText}
                            </p>
                            <p className="text-[var(--text)]">
                              {formatYmLabel(previousYm)}: {previousText}
                            </p>
                          </div>
                        );
                      }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }}
                      formatter={(value) => (
                        <span style={{ color: "#4e5968" }}>{value}</span>
                      )}
                    />
                    <Bar
                      dataKey="previousValue"
                      name="1년 전 같은 달"
                      fill={BAR_COLORS.previous}
                      radius={[2, 2, 0, 0]}
                    />
                    <Bar
                      dataKey="recentValue"
                      name="해당 월"
                      fill={BAR_COLORS.current}
                      radius={[2, 2, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-medium text-[var(--text-secondary)]">
                요일별 {title} 분석
              </h3>
              <div className="h-[320px] w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={200}>
                  <BarChart
                    data={weekdayRows}
                    margin={{ top: 8, right: 12, bottom: 8, left: 4 }}
                  >
                    <CartesianGrid stroke="#e5e8eb" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="weekdayLabel"
                      stroke="#d1d6db"
                      tick={{ fill: "#8b95a1", fontSize: 11 }}
                    />
                    <YAxis
                      stroke="#d1d6db"
                      tick={{ fill: "#8b95a1", fontSize: 11 }}
                      tickFormatter={(val) => formatAxis(valueFormat, Number(val))}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      labelStyle={{ color: "#191f28" }}
                      content={({ payload }) => {
                        const row = payload?.[0]?.payload as
                          | {
                              weekdayLabel?: string;
                              recentDateKey?: string | null;
                            }
                          | undefined;
                        const recentText = formatDateWithWeekday(
                          row?.recentDateKey ?? null
                        );
                        const avgItem = payload?.find(
                          (p) => p.dataKey === "avgLast12Months"
                        );
                        const last7Item = payload?.find(
                          (p) => p.dataKey === "last7DayValue"
                        );
                        const avgRaw = avgItem?.value;
                        const last7Raw = last7Item?.value;
                        const avgNum =
                          typeof avgRaw === "number" ? avgRaw : Number(avgRaw);
                        const last7Num =
                          typeof last7Raw === "number" ? last7Raw : Number(last7Raw);
                        const avgText = formatValue(
                          valueFormat !== "currency" ? "decimal" : valueFormat,
                          Number.isFinite(avgNum) ? avgNum : null,
                          valueFormat === "currency" ? undefined : valueSuffix
                        );
                        const last7Text = formatValue(
                          valueFormat,
                          Number.isFinite(last7Num) ? last7Num : null,
                          valueSuffix
                        );
                        return (
                          <div className="rounded border border-[var(--border-strong)] bg-white px-2.5 py-1.5 text-xs shadow-lg">
                            <p className="mb-1 text-[var(--text-secondary)]">{row?.weekdayLabel ?? ""}</p>
                            <p className="text-[var(--text)]">
                              최근 12개월 {row?.weekdayLabel ?? "해당 요일"} 평균:{" "}
                              {avgText}
                            </p>
                            <p className="text-[var(--text)]">
                              {recentText}: {last7Text}
                            </p>
                          </div>
                        );
                      }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }}
                      formatter={(value) => (
                        <span style={{ color: "#4e5968" }}>{value}</span>
                      )}
                    />
                    <Bar
                      dataKey="avgLast12Months"
                      name="12개월 일평균"
                      fill={BAR_COLORS.previous}
                      radius={[2, 2, 0, 0]}
                    />
                    <Bar
                      dataKey="last7DayValue"
                      name="최근 7일 해당 요일"
                      fill={BAR_COLORS.current}
                      radius={[2, 2, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
