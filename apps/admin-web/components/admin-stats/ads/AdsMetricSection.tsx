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
import type { SearchAdDailyRow } from "@/lib/admin-stats/queries-server";
import {
  addDaysFromDateKey,
  buildAdsTotalSeries,
  getDataBounds,
  type AdsMetric,
} from "@/lib/admin-stats/ads-aggregates";
import { computeYAxisConfig, maxOfNullable } from "@/lib/chart-utils";

const METRIC_CONFIG: Record<
  AdsMetric,
  { color: string; format: "integer" | "percent" | "currency" }
> = {
  impressions: { color: "#3b82f6", format: "integer" },
  clicks: { color: "#10b981", format: "integer" },
  ctr: { color: "#f59e0b", format: "percent" },
  cost: { color: "#ec4899", format: "currency" },
};

function formatValue(metric: AdsMetric, v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const { format } = METRIC_CONFIG[metric];
  if (format === "currency") {
    return `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(v)}원`;
  }
  if (format === "percent") {
    return `${v.toFixed(2)}%`;
  }
  return `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(v)}회`;
}

function formatAxis(metric: AdsMetric, v: number): string {
  if (!Number.isFinite(v)) return "";
  if (metric === "ctr") return `${v.toFixed(1)}%`;
  if (metric === "cost") {
    return new Intl.NumberFormat("ko-KR", {
      notation: "compact",
      maximumFractionDigits: 0,
    }).format(v);
  }
  return new Intl.NumberFormat("ko-KR", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(v);
}

function clipRange(start: string, end: string, min: string, max: string) {
  let s = start < min ? min : start;
  let e = end > max ? max : end;
  if (s > e) {
    s = min;
    e = max;
  }
  return { start: s, end: e };
}

const tooltipStyle = {
  backgroundColor: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: "0",
};

type Props = {
  title: string;
  description?: string;
  rows: SearchAdDailyRow[];
  metric: AdsMetric;
};

export default function AdsMetricSection({ title, description, rows, metric }: Props) {
  const bounds = useMemo(() => getDataBounds(rows), [rows]);
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");

  const minB = bounds?.min ?? "";
  const maxB = bounds?.max ?? "";
  const clipped = useMemo(
    () =>
      minB && maxB
        ? clipRange(rangeStart || minB, rangeEnd || maxB, minB, maxB)
        : { start: "", end: "" },
    [rangeStart, rangeEnd, minB, maxB]
  );

  const chartData = useMemo(
    () =>
      clipped.start && clipped.end
        ? buildAdsTotalSeries(rows, clipped.start, clipped.end)
        : [],
    [rows, clipped]
  );

  const yAxis = useMemo(
    () => computeYAxisConfig(maxOfNullable(chartData.map((p) => p[metric] as number | null))),
    [chartData, metric],
  );

  const setPreset = (preset: "all" | "1y" | "90d") => {
    if (!bounds) return;
    if (preset === "all") {
      setRangeStart(bounds.min);
      setRangeEnd(bounds.max);
      return;
    }
    const days = preset === "90d" ? 90 : 365;
    const from = addDaysFromDateKey(bounds.max, -days);
    setRangeStart(from < bounds.min ? bounds.min : from);
    setRangeEnd(bounds.max);
  };

  const { color } = METRIC_CONFIG[metric];

  return (
    <section className="border-b border-slate-200 bg-white p-4 sm:p-5 last:border-b-0">
      <header className="mb-4">
        <h2 className="text-base font-semibold text-slate-900 sm:text-lg">{title}</h2>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </header>

      {!bounds ? (
        <p className="border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
          표시할 데이터가 없습니다.
        </p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <div className="flex flex-wrap gap-2">
              <label className="flex flex-col gap-0.5 text-xs text-slate-500">
                시작
                <input
                  type="date"
                  className="h-8 border border-slate-300 bg-white px-2 text-xs text-slate-900"
                  min={minB}
                  max={maxB}
                  value={rangeStart || minB}
                  onChange={(e) => setRangeStart(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-0.5 text-xs text-slate-500">
                종료
                <input
                  type="date"
                  className="h-8 border border-slate-300 bg-white px-2 text-xs text-slate-900"
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
                  ["90d", "최근 90일"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPreset(key)}
                  className="h-8 border border-slate-300 bg-white px-2.5 text-xs text-slate-700 hover:bg-slate-50"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="h-[260px] w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 8, left: 4 }}>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                <XAxis
                  dataKey="label"
                  stroke="#cbd5e1"
                  tick={{ fill: "#64748b", fontSize: 11 }}
                  interval="preserveStartEnd"
                  minTickGap={24}
                />
                <YAxis
                  stroke="#cbd5e1"
                  tick={{ fill: "#64748b", fontSize: 11 }}
                  tickFormatter={(v) => formatAxis(metric, Number(v))}
                  domain={yAxis.domain}
                  ticks={yAxis.ticks}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  content={({ payload, label }) => {
                    const raw = payload?.[0]?.value;
                    const n = typeof raw === "number" ? raw : Number(raw);
                    return (
                      <div className="rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-lg">
                        <p className="mb-1 text-slate-500">{label}</p>
                        <p className="text-slate-900">
                          {formatValue(metric, Number.isFinite(n) ? n : null)}
                        </p>
                      </div>
                    );
                  }}
                />
                <Line
                  type="monotone"
                  dataKey={metric}
                  name={title}
                  stroke={color}
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-xs italic text-slate-400">
            값이 없는 날은 선이 끊깁니다.
          </p>
        </>
      )}
    </section>
  );
}
