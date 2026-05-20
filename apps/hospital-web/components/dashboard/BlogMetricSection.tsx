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
import type { BlogPeriodDayRow } from "@/lib/queries";
import {
  addDaysFromDateKey,
  buildBlogSeries,
  getDataBounds,
  type BlogMetricKey,
  type Granularity,
} from "@/lib/blog-aggregates";

const tooltipStyle = {
  backgroundColor: "#18181b",
  border: "1px solid #27272a",
  borderRadius: "0",
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
  description,
  rows,
  metric,
  valueSuffix,
  footnote,
}: BlogMetricSectionProps) {
  const bounds = useMemo(() => getDataBounds(rows), [rows]);
  const [granularity, setGranularity] = useState<Granularity>("day");
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

  const setPreset = (preset: "all" | "1y" | "3y") => {
    if (!bounds) return;
    if (preset === "all") {
      setRangeStart(bounds.min);
      setRangeEnd(bounds.max);
      return;
    }
    const years = preset === "1y" ? 1 : 3;
    const from = addDaysFromDateKey(bounds.max, -years * 365);
    setRangeStart(from < bounds.min ? bounds.min : from);
    setRangeEnd(bounds.max);
  };

  const hasData = rows.length > 0 && bounds != null;

  return (
    <section className="border-b border-[var(--border)] bg-[var(--bg-raised)] p-4 sm:p-5 last:border-b-0">
      <header className="mb-4">
        <h2 className="text-base font-semibold text-zinc-100 sm:text-lg">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm text-zinc-500">{description}</p>
        ) : null}
      </header>

      {!hasData ? (
        <p className="border border-[var(--border)] bg-[var(--bg)] p-4 text-sm text-zinc-500">
          표시할 데이터가 없습니다.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-wrap gap-2">
              <label className="flex flex-col gap-0.5 text-xs text-zinc-500">
                시작
                <input
                  type="date"
                  className="h-8 border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-100"
                  min={minB}
                  max={maxB}
                  value={rangeStart || minB}
                  onChange={(e) => setRangeStart(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-0.5 text-xs text-zinc-500">
                종료
                <input
                  type="date"
                  className="h-8 border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-100"
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
                  ["3y", "최근 3년"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPreset(key)}
                  className="h-8 border border-zinc-700 bg-zinc-900 px-2.5 text-xs text-zinc-300 hover:bg-zinc-800"
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="ml-auto flex rounded border border-zinc-700 p-0.5">
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
                      ? "bg-zinc-100 text-zinc-900"
                      : "text-zinc-400 hover:text-zinc-200"
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
                <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                <XAxis
                  dataKey="label"
                  stroke="#52525b"
                  tick={{ fill: "#a1a1aa", fontSize: 11 }}
                  interval="preserveStartEnd"
                  minTickGap={24}
                />
                <YAxis
                  stroke="#52525b"
                  tick={{ fill: "#a1a1aa", fontSize: 11 }}
                  tickFormatter={(val) => formatAxis(Number(val))}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelStyle={{ color: "#fafafa" }}
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
                    return (
                      <div className="rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs shadow-lg">
                        <p className="mb-1 text-zinc-400">{label}</p>
                        <p className="text-zinc-100">
                          값{" "}
                          <span className="text-zinc-300">
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
                  stroke="#60a5fa"
                  strokeWidth={2}
                  dot={
                    granularity === "day"
                      ? false
                      : { r: 3, fill: "#60a5fa", strokeWidth: 0 }
                  }
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs italic text-zinc-600">
            기간은 서울 기준 날짜이며, 차트에 값이 없는 구간은 선이 끊깁니다.
            {footnote ? ` ${footnote}` : ""}
          </p>
        </div>
      )}
    </section>
  );
}
