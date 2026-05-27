"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
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
  buildCampaignCtrSeries,
  getCampaigns,
  getDataBounds,
} from "@/lib/admin-stats/ads-aggregates";
import { Y_AXIS_AUTO_DOMAIN } from "@/lib/chart-utils";

const CAMPAIGN_COLORS = [
  "#3b82f6",
  "#ec4899",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#f97316",
  "#06b6d4",
  "#22c55e",
];

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
  rows: SearchAdDailyRow[];
};

export default function AdsCampaignCtrSection({ rows }: Props) {
  const bounds = useMemo(() => getDataBounds(rows), [rows]);
  const campaigns = useMemo(() => getCampaigns(rows), [rows]);
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
        ? buildCampaignCtrSeries(rows, clipped.start, clipped.end, campaigns)
        : [],
    [rows, clipped, campaigns]
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

  const visibleCampaigns = campaigns.slice(0, 8);

  return (
    <section className="bg-white p-4 sm:p-5">
      <header className="mb-4">
        <h2 className="text-base font-semibold text-slate-900 sm:text-lg">
          캠페인별 클릭률 (CTR)
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          캠페인별 일별 클릭률을 한 그래프에서 비교합니다.
        </p>
      </header>

      {!bounds || campaigns.length === 0 ? (
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

          <div className="h-[320px] w-full min-w-0">
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
                  tickFormatter={(v) => `${Number(v).toFixed(1)}%`}
                  domain={Y_AXIS_AUTO_DOMAIN}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  content={({ payload, label }) => (
                    <div className="rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-lg">
                      <p className="mb-1 text-slate-500">{label}</p>
                      {payload?.map((p) => {
                        const n =
                          typeof p.value === "number" ? p.value : Number(p.value);
                        return (
                          <p key={String(p.dataKey)} style={{ color: p.color as string }}>
                            {p.name}:{" "}
                            {Number.isFinite(n) ? `${n.toFixed(2)}%` : "—"}
                          </p>
                        );
                      })}
                    </div>
                  )}
                />
                <Legend
                  wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }}
                  formatter={(value) => (
                    <span style={{ color: "#475569" }}>{value}</span>
                  )}
                />
                {visibleCampaigns.map(({ id, name }, i) => (
                  <Line
                    key={id}
                    type="monotone"
                    dataKey={id}
                    name={name}
                    stroke={CAMPAIGN_COLORS[i % CAMPAIGN_COLORS.length]}
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          {campaigns.length > 8 && (
            <p className="mt-1 text-xs text-slate-500">
              캠페인이 {campaigns.length}개입니다. 상위 8개만 표시됩니다.
            </p>
          )}
          <p className="mt-1 text-xs italic text-slate-400">
            값이 없는 날은 선이 끊깁니다.
          </p>
        </>
      )}
    </section>
  );
}
