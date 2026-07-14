"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { BlogPeriodDayRow } from "@/lib/hospital-dashboard/types";
import {
  addDaysFromDateKey,
  buildBlogSeries,
  getDataBounds,
  type BlogMetricKey,
  type Granularity,
} from "@/lib/hospital-dashboard/blog-aggregates";
import { computeYAxisConfig, maxOfNullable } from "@/lib/hospital-dashboard/chart-utils";

const tooltipStyle = {
  backgroundColor: "#ffffff",
  border: "1px solid #e5e8eb",
  borderRadius: "8px",
};

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

function formatNumber(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(v);
}

function formatAxis(v: number) {
  if (!Number.isFinite(v)) return "";
  return new Intl.NumberFormat("ko-KR", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(v);
}

export type BlogMetricSectionProps = {
  title: string;
  description?: string;
  rows: BlogPeriodDayRow[];
  metric: BlogMetricKey;
  /** 단위 표기 (예: 회, 명) */
  valueSuffix?: string;
  /** 차트 아래 작은 안내 문구 */
  footnote?: string;
};

export default function BlogMetricSection({
  title,
  rows,
  metric,
  valueSuffix,
  footnote,
}: BlogMetricSectionProps) {
  const bounds = useMemo(() => getDataBounds(rows), [rows]);
  const [granularity, setGranularity] = useState<Granularity>("month");
  const [rangeStart, setRangeStart] = useState<string>("");
  const [rangeEnd, setRangeEnd] = useState<string>("");

  const effectiveBounds = bounds ?? { min: "", max: "" };
  const minB = effectiveBounds.min;
  const maxB = effectiveBounds.max;

  const start = rangeStart || minB;
  const end = rangeEnd || maxB;
  const clipped = useMemo(
    () =>
      minB && maxB ? clipRange(start, end, minB, maxB) : { start: "", end: "" },
    [start, end, minB, maxB]
  );

  const chartData = useMemo(() => {
    if (!clipped.start || !clipped.end || rows.length === 0) return [];
    return buildBlogSeries(rows, clipped.start, clipped.end, granularity, metric);
  }, [rows, clipped, granularity, metric]);

  const yAxis = useMemo(
    () => computeYAxisConfig(maxOfNullable(chartData.map((p) => p.value))),
    [chartData],
  );

  const setPreset = (preset: "all" | "1y" | "6m") => {
    if (!bounds) return;
    if (preset === "all") {
      setRangeStart(bounds.min);
      setRangeEnd(bounds.max);
      return;
    }
    const days = preset === "1y" ? 365 : 180;
    const from = addDaysFromDateKey(bounds.max, -days);
    setRangeStart(from < bounds.min ? bounds.min : from);
    setRangeEnd(bounds.max);
  };

  const hasData = rows.length > 0 && bounds != null;

  return (
    <section>
      <header className="mb-4">
        <h2 className="text-base font-semibold text-[var(--text)]">{title}</h2>
      </header>

      {!hasData ? (
        <p className="border border-[var(--border)] bg-[var(--bg)] p-4 text-sm text-[var(--text-muted)]">
          표시할 데이터가 없습니다.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-wrap gap-2">
              <label className="flex flex-col gap-0.5 text-xs text-[var(--text-muted)]">
                시작
                <input
                  type="date"
                  className="h-8 border border-[var(--border-strong)] bg-[var(--bg)] px-2 text-xs text-[var(--text)]"
                  min={minB}
                  max={maxB}
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
                  max={maxB}
                  value={rangeEnd || maxB}
                  onChange={(e) => setRangeEnd(e.target.value)}
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-1">
              {(
                [
                  ["all", "전체"],
                  ["1y", "최근 1년"],
                  ["6m", "최근 6개월"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPreset(key)}
                  className="h-8 cursor-pointer border border-[var(--border-strong)] bg-[var(--bg)] px-2.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]"
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
                  tickFormatter={(val) => formatAxis(Number(val))}
                  domain={yAxis.domain}
                  ticks={yAxis.ticks}
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
                    const text = formatNumber(Number.isFinite(n) ? n : null);
                    const suffix = valueSuffix ?? "";
                    const pointSortKey = (payload?.[0]?.payload as { sortKey?: string } | undefined)?.sortKey;
                    const displayLabel =
                      granularity === "day" && pointSortKey
                        ? pointSortKey.replace(/-/g, "/")
                        : label;
                    return (
                      <div className="rounded border border-[var(--border-strong)] bg-white px-2.5 py-1.5 text-xs shadow-lg">
                        <p className="mb-1 text-[var(--text-secondary)]">{displayLabel}</p>
                        <p className="text-[var(--text)]">
                          값{" "}
                          <span className="text-[var(--text-secondary)]">
                            {text}
                            {suffix}
                          </span>
                        </p>
                      </div>
                    );
                  }}
                />
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
          <p className="text-xs italic text-[var(--text-muted)]">
            기간은 서울 기준 날짜이며, 차트에 값이 없는 구간은 선이 끊깁니다.
            {footnote ? ` ${footnote}` : ""}
          </p>
        </div>
      )}
    </section>
  );
}
