"use client";

import { useMemo, useState, Fragment } from "react";
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
import type { SearchAdRow } from "@/lib/queries";
import {
  buildCampaignTable,
  buildCampaignTrend,
  buildTopKeywords,
  deriveMetric,
  getDataBounds,
  type Granularity,
  type PerfTotals,
  type SearchAdMetricKey,
} from "@/lib/searchad-aggregates";
import { computeYAxisConfig, maxOfNullable } from "@/lib/chart-utils";

const tooltipStyle = {
  backgroundColor: "#ffffff",
  border: "1px solid #e5e8eb",
  borderRadius: "8px",
};

const LINE_COLORS = [
  "#3182F6",
  "#f97316",
  "#10b981",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#eab308",
  "#64748b",
];

const CAMPAIGN_TYPE_LABELS: Record<string, string> = {
  WEB_SITE: "파워링크",
  PLACE: "플레이스",
  SHOPPING: "쇼핑검색",
  POWER_CONTENTS: "파워컨텐츠",
  BRAND_SEARCH: "브랜드검색",
  PLACE_SEARCH: "플레이스",
};

function campaignTypeLabel(tp: string): string {
  return CAMPAIGN_TYPE_LABELS[tp] ?? tp;
}

const METRICS: { key: SearchAdMetricKey; label: string }[] = [
  { key: "impressions", label: "노출" },
  { key: "clicks", label: "클릭" },
  { key: "ctr", label: "클릭율" },
  { key: "cost", label: "비용" },
  { key: "cpc", label: "CPC" },
];

function formatMetric(metric: SearchAdMetricKey, v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const nf = (d: number) => new Intl.NumberFormat("ko-KR", { maximumFractionDigits: d });
  switch (metric) {
    case "ctr":
      return `${nf(2).format(v)}%`;
    case "cost":
    case "cpc":
      return `${nf(0).format(v)}원`;
    default:
      return nf(0).format(v);
  }
}

function clipRange(start: string, end: string, minB: string, maxB: string) {
  let s = start < minB ? minB : start;
  let e = end > maxB ? maxB : end;
  if (s > e) {
    s = minB;
    e = maxB;
  }
  return { start: s, end: e };
}

function addDaysToDateKey(dateKey: string, delta: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + delta * 86400000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

export default function SearchAdSection({
  rows,
  lockedType,
  mode = "full",
}: {
  rows: SearchAdRow[];
  /** 지정 시 그 캠페인 유형만 표시하고 유형 토글은 숨김 (예: "WEB_SITE", "PLACE"). */
  lockedType?: string;
  /** "summary" 면 추세 차트만 (캠페인 표·Top키워드 숨김). */
  mode?: "full" | "summary";
}) {
  const bounds = useMemo(() => getDataBounds(rows), [rows]);
  const [granularity, setGranularity] = useState<Granularity>("month");
  const [trendMetric, setTrendMetric] = useState<SearchAdMetricKey>("clicks");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [typeFilter, setTypeFilter] = useState<string>("all");

  // 데이터에 존재하는 캠페인 유형 (campaign-level row 기준). campaign_type 미수집(NULL)이면 빈 목록.
  const availableTypes = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.campaignType) set.add(r.campaignType);
    }
    return Array.from(set).sort();
  }, [rows]);

  const effectiveType = lockedType ?? typeFilter;
  const filteredRows = useMemo(
    () => (effectiveType === "all" ? rows : rows.filter((r) => r.campaignType === effectiveType)),
    [rows, effectiveType],
  );

  const minB = bounds?.min ?? "";
  const maxB = bounds?.max ?? "";
  const start = rangeStart || minB;
  const end = rangeEnd || maxB;
  const clipped = useMemo(
    () => (minB && maxB ? clipRange(start, end, minB, maxB) : { start: "", end: "" }),
    [start, end, minB, maxB],
  );

  const campaignTable = useMemo(
    () => (clipped.start ? buildCampaignTable(filteredRows, clipped.start, clipped.end) : []),
    [filteredRows, clipped],
  );
  const topKeywords = useMemo(
    () => (clipped.start ? buildTopKeywords(filteredRows, clipped.start, clipped.end, 10) : []),
    [filteredRows, clipped],
  );
  const trend = useMemo(
    () =>
      clipped.start
        ? buildCampaignTrend(filteredRows, clipped.start, clipped.end, granularity, trendMetric)
        : { points: [], campaigns: [] },
    [filteredRows, clipped, granularity, trendMetric],
  );

  const trendYAxis = useMemo(() => {
    const vals: (number | null)[] = [];
    for (const p of trend.points) {
      for (const c of trend.campaigns) vals.push(p[c.id] as number | null);
    }
    return computeYAxisConfig(maxOfNullable(vals));
  }, [trend]);

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

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (!bounds || rows.length === 0) {
    return (
      <p className="border border-[var(--border)] bg-[var(--bg)] p-4 text-sm text-[var(--text-muted)]">
        표시할 광고 데이터가 없습니다.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {/* 컨트롤 */}
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

      {/* 광고 유형 필터 (파워링크 / 플레이스 등) — lockedType 없을 때만 */}
      {!lockedType && availableTypes.length > 0 && (
        <div className="-mt-4 flex flex-wrap items-center gap-1">
          <span className="mr-1 text-xs text-[var(--text-muted)]">광고 유형</span>
          {[["all", "전체"] as const, ...availableTypes.map((t) => [t, campaignTypeLabel(t)] as const)].map(
            ([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTypeFilter(key)}
                className={`h-7 rounded border px-2.5 text-xs ${
                  typeFilter === key
                    ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                    : "border-[var(--border-strong)] bg-[var(--bg)] text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]"
                }`}
              >
                {label}
              </button>
            ),
          )}
        </div>
      )}

      {/* 추세 (캠페인별 멀티라인) */}
      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-[var(--text-secondary)]">
            캠페인별 추세
          </h3>
          <div className="flex rounded border border-[var(--border-strong)] p-0.5">
            {METRICS.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setTrendMetric(m.key)}
                className={`px-2.5 py-1 text-xs ${
                  trendMetric === m.key
                    ? "bg-[var(--accent)] text-white"
                    : "text-[var(--text-secondary)] hover:text-[var(--text)]"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <div className="h-[300px] w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={200}>
            <LineChart data={trend.points} margin={{ top: 8, right: 12, bottom: 8, left: 4 }}>
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
                tickFormatter={(v) => formatMetric(trendMetric, Number(v))}
                domain={trendYAxis.domain}
                ticks={trendYAxis.ticks}
                width={64}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                labelStyle={{ color: "#191f28" }}
                formatter={(value, name) => [
                  formatMetric(trendMetric, typeof value === "number" ? value : Number(value)),
                  name,
                ]}
              />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
              {trend.campaigns.map((c, i) => (
                <Line
                  key={c.id}
                  type="monotone"
                  dataKey={c.id}
                  name={c.name}
                  stroke={LINE_COLORS[i % LINE_COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      {mode === "full" && (
      <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
      {/* 캠페인 / 광고그룹 성과표 */}
      <section>
        <h3 className="mb-2 text-sm font-medium text-[var(--text-secondary)]">
          캠페인 · 광고그룹 성과
        </h3>
        <div className="overflow-x-auto border border-[var(--border)]">
          <table className="w-full table-fixed border-collapse text-left text-sm">
            <AdTableColgroup />
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--bg-subtle)] text-[var(--text-secondary)]">
                <th className="py-2 pl-3 pr-2 font-medium">캠페인 / 광고그룹</th>
                <th className="py-2 px-2 text-right font-medium">노출</th>
                <th className="py-2 px-2 text-right font-medium">클릭</th>
                <th className="py-2 px-2 text-right font-medium">클릭율</th>
                <th className="py-2 px-2 text-right font-medium">비용</th>
                <th className="py-2 pl-2 pr-3 text-right font-medium">CPC</th>
              </tr>
            </thead>
            <tbody>
              {campaignTable.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-[var(--text-muted)]">
                    선택 기간에 데이터가 없습니다.
                  </td>
                </tr>
              ) : (
                campaignTable.map((c) => {
                  const open = expanded.has(c.campaignId);
                  return (
                    <Fragment key={c.campaignId}>
                      <tr
                        className="cursor-pointer border-b border-[var(--border)] text-[var(--text)] hover:bg-[var(--bg-subtle)]"
                        onClick={() => toggleExpand(c.campaignId)}
                      >
                        <td className="py-2 pl-3 pr-2 font-medium">
                          <span className="mr-1.5 inline-block w-3 text-[var(--text-muted)]">
                            {c.adgroups.length > 0 ? (open ? "▾" : "▸") : ""}
                          </span>
                          {c.campaignName}
                        </td>
                        <MetricCells totals={c.totals} />
                      </tr>
                      {open &&
                        c.adgroups.map((a) => (
                          <tr
                            key={a.adgroupId}
                            className="border-b border-[var(--border)] bg-[var(--bg-subtle)] text-[var(--text-secondary)]"
                          >
                            <td className="py-1.5 pl-8 pr-2">{a.adgroupName}</td>
                            <MetricCells totals={a.totals} />
                          </tr>
                        ))}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 클릭수 상위 키워드 */}
      <section>
        <h3 className="mb-2 text-sm font-medium text-[var(--text-secondary)]">
          클릭수 상위 키워드 (Top 10)
        </h3>
        <div className="overflow-x-auto border border-[var(--border)]">
          <table className="w-full table-fixed border-collapse text-left text-sm">
            <AdTableColgroup />
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--bg-subtle)] text-[var(--text-secondary)]">
                <th className="py-2 pl-3 pr-2 font-medium">키워드</th>
                <th className="py-2 px-2 text-right font-medium">노출</th>
                <th className="py-2 px-2 text-right font-medium">클릭</th>
                <th className="py-2 px-2 text-right font-medium">클릭율</th>
                <th className="py-2 px-2 text-right font-medium">비용</th>
                <th className="py-2 pl-2 pr-3 text-right font-medium">CPC</th>
              </tr>
            </thead>
            <tbody>
              {topKeywords.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-[var(--text-muted)]">
                    선택 기간에 키워드 데이터가 없습니다.
                  </td>
                </tr>
              ) : (
                topKeywords.map((k) => (
                  <tr key={k.keywordId} className="border-b border-[var(--border)] text-[var(--text)]">
                    <td className="py-1.5 pl-3 pr-2">{k.keywordName}</td>
                    <MetricCells totals={k.totals} />
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
      </div>
      )}
    </div>
  );
}

/** 두 표(캠페인·키워드) 컬럼 너비 통일용. 이름 30% + 지표 5개 14%씩. */
function AdTableColgroup() {
  return (
    <colgroup>
      <col style={{ width: "30%" }} />
      <col style={{ width: "14%" }} />
      <col style={{ width: "14%" }} />
      <col style={{ width: "14%" }} />
      <col style={{ width: "14%" }} />
      <col style={{ width: "14%" }} />
    </colgroup>
  );
}

function MetricCells({ totals }: { totals: PerfTotals }) {
  return (
    <>
      <td className="py-1.5 px-2 text-right tabular-nums whitespace-nowrap">
        {formatMetric("impressions", deriveMetric(totals, "impressions"))}
      </td>
      <td className="py-1.5 px-2 text-right tabular-nums whitespace-nowrap">
        {formatMetric("clicks", deriveMetric(totals, "clicks"))}
      </td>
      <td className="py-1.5 px-2 text-right tabular-nums whitespace-nowrap">
        {formatMetric("ctr", deriveMetric(totals, "ctr"))}
      </td>
      <td className="py-1.5 px-2 text-right tabular-nums whitespace-nowrap">
        {formatMetric("cost", deriveMetric(totals, "cost"))}
      </td>
      <td className="py-1.5 pl-2 pr-3 text-right tabular-nums whitespace-nowrap">
        {formatMetric("cpc", deriveMetric(totals, "cpc"))}
      </td>
    </>
  );
}
