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
import {
  summarizeMetaActions,
  META_FUNNEL_WEB_STEP_PRIORITY,
} from "@dashboard/meta-ads-metrics";
import type {
  MetaAdsConversionRow,
  MetaAdsDailyRow,
  MetaAdsStatus,
} from "@/lib/hospital-dashboard/types";

/** 차트 색은 CSS 변수로 — SearchAdSection 은 #ffffff 등을 하드코딩해 다크에서 어긋난다. */
const AXIS = "var(--border-strong)";
const GRID = "var(--border)";
const TICK = "var(--text-muted)";
const SERIES = "var(--accent)";

const tooltipStyle = {
  backgroundColor: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: "8px",
};

type MetricKey = "impressions" | "clicks" | "ctr" | "spend" | "cpc";
type Granularity = "day" | "month";

/** 파워링크 탭과 같은 5지표 토글. */
const METRICS: { key: MetricKey; label: string }[] = [
  { key: "impressions", label: "노출" },
  { key: "clicks", label: "클릭" },
  { key: "ctr", label: "클릭율" },
  { key: "spend", label: "비용" },
  { key: "cpc", label: "CPC" },
];

function formatMetric(metric: MetricKey, v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (metric === "ctr") return `${v.toFixed(2)}%`;
  if (metric === "spend" || metric === "cpc") {
    return `${Math.round(v).toLocaleString("ko-KR")}원`;
  }
  return Math.round(v).toLocaleString("ko-KR");
}

function num(v: number): string {
  return Math.round(v).toLocaleString("ko-KR");
}

/**
 * 합산 가능한 지표만 담는다. **도달(reach)은 일부러 넣지 않았다** — 중복 제거된 사람 수라
 * 일별 값을 더하면 같은 사람을 여러 번 세게 된다(실측 빈도 1.04 라는 불가능한 값이 나왔다).
 * 원시 일별 도달은 MetaAdsDailyRow 에 그대로 있으니 하루 단위로 쓸 일이 생기면 거기서 읽으면 된다.
 */
type Totals = {
  impressions: number;
  clicks: number;
  spend: number;
};

function derive(t: Totals, metric: MetricKey): number {
  switch (metric) {
    case "impressions":
      return t.impressions;
    case "clicks":
      return t.clicks;
    case "ctr":
      return t.impressions > 0 ? (t.clicks / t.impressions) * 100 : 0;
    case "spend":
      return t.spend;
    case "cpc":
      return t.clicks > 0 ? t.spend / t.clicks : 0;
  }
}

function KpiBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--accent)]/20 bg-[var(--accent-subtle)] px-4 py-3.5">
      <div className="text-xs text-[var(--text-secondary)]">{label}</div>
      <div className="mt-1.5 text-2xl font-bold tabular-nums text-[var(--text)]">
        {value}
      </div>
    </div>
  );
}

/**
 * 데이터가 한 행도 없을 때 — 세 경우를 구분한다. 한 문장으로 덮으면 ①광고를 안 하는 병원
 * ②연동 누락 ③첫 수집 전 이 섞여, 연동이 빠진 병원이 조용히 방치된다.
 */
function EmptyState({
  status,
  showDiagnostics,
}: {
  status: MetaAdsStatus | null;
  showDiagnostics: boolean;
}) {
  const linked = Boolean(status?.isActive && status?.adAccountId);
  const synced = Boolean(status?.lastSyncedAt);

  let title: string;
  let body: string;
  if (!linked) {
    title = "인스타그램 광고를 운영하지 않는 병원입니다";
    body =
      "광고를 시작하셨다면 담당자에게 알려주세요. 연동 후 성과가 이 화면에 표시됩니다.";
  } else if (!synced) {
    title = "연동이 완료되었습니다";
    body = "첫 수집 후(보통 1일 이내) 데이터가 표시됩니다.";
  } else {
    title = "표시할 광고 데이터가 없습니다";
    body = "연동은 되어 있지만 최근 6개월 안에 집행된 광고가 없습니다.";
  }

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-4">
      <p className="text-sm font-semibold text-[var(--text)]">{title}</p>
      <p className="mt-1 text-sm text-[var(--text-muted)]">{body}</p>
      {showDiagnostics ? (
        <p className="mt-2 text-[11px] text-[var(--text-muted)]">
          광고계정 {status?.adAccountId || "미지정"} · 수집 사용{" "}
          {status?.isActive ? "ON" : "OFF"} · 마지막 수집{" "}
          {status?.lastSyncedAt
            ? new Date(status.lastSyncedAt).toLocaleString("ko-KR", {
                dateStyle: "short",
                timeStyle: "short",
              })
            : "없음"}
        </p>
      ) : null}
    </div>
  );
}

export default function MetaAdsSection({
  daily,
  conversions,
  status = null,
  showDiagnostics = false,
}: {
  daily: MetaAdsDailyRow[];
  conversions: MetaAdsConversionRow[];
  status?: MetaAdsStatus | null;
  /** admin 화면에서 true — 왜 비었는지 관리자가 바로 판단할 수 있게 연동 상태를 함께 보여준다. */
  showDiagnostics?: boolean;
}) {
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [trendMetric, setTrendMetric] = useState<MetricKey>("clicks");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");

  const bounds = useMemo(() => {
    const dates = daily
      .map((d) => d.metricDate)
      .filter(Boolean)
      .sort();
    if (dates.length === 0) return null;
    return { min: dates[0], max: dates[dates.length - 1] };
  }, [daily]);

  const minB = bounds?.min ?? "";
  const maxB = bounds?.max ?? "";
  const start = rangeStart || minB;
  const end = rangeEnd || maxB;

  const rows = useMemo(
    () =>
      daily.filter(
        (r) =>
          (!start || r.metricDate >= start) && (!end || r.metricDate <= end),
      ),
    [daily, start, end],
  );
  const convRows = useMemo(
    () =>
      conversions.filter(
        (r) =>
          (!start || r.metricDate >= start) && (!end || r.metricDate <= end),
      ),
    [conversions, start, end],
  );

  const overall = useMemo(() => {
    const t: Totals = { impressions: 0, clicks: 0, spend: 0 };
    for (const r of rows) {
      t.impressions += r.impressions;
      t.clicks += r.clicks;
      t.spend += r.spend;
    }
    return t;
  }, [rows]);

  /** 추세 — 일별/월별로 접고, 선택한 지표 하나만 그린다(시리즈 1개라 범례 불필요). */
  const trend = useMemo(() => {
    const byKey = new Map<string, Totals>();
    for (const r of rows) {
      const key =
        granularity === "month" ? r.metricDate.slice(0, 7) : r.metricDate;
      const cur = byKey.get(key) ?? {
        impressions: 0,
        clicks: 0,
        spend: 0,
      };
      cur.impressions += r.impressions;
      cur.clicks += r.clicks;
      cur.spend += r.spend;
      byKey.set(key, cur);
    }
    return [...byKey.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([label, t]) => ({ label, value: derive(t, trendMetric) }));
  }, [rows, granularity, trendMetric]);

  const actions = useMemo(() => summarizeMetaActions(convRows), [convRows]);

  const adTable = useMemo(() => {
    const byAd = new Map<string, { name: string; campaign: string } & Totals>();
    for (const r of rows) {
      const key = r.adId || r.adName || "(알 수 없음)";
      const cur = byAd.get(key) ?? {
        name: r.adName || "(이름 없음)",
        campaign: r.campaignName || "-",
        impressions: 0,
        clicks: 0,
        spend: 0,
      };
      cur.impressions += r.impressions;
      cur.clicks += r.clicks;
      cur.spend += r.spend;
      byAd.set(key, cur);
    }
    return [...byAd.values()].sort((a, b) => b.spend - a.spend);
  }, [rows]);

  /**
   * 유입 흐름 — 노출 → 링크 클릭 → 랜딩 페이지 조회 → 콘텐츠 조회.
   *
   * 클릭은 `clicks`(전체) 대신 **`link_click`** 을 쓴다. 전체 클릭에는 좋아요·프로필 클릭처럼
   * 사이트로 갈 의도가 없는 클릭이 섞여 있어(실측 1,554 vs 1,408), 분모로 쓰면 랜딩 도달률이
   * 실제보다 나빠 보인다(77% vs 85%).
   *
   * 마지막에 실제 전환(예약·잠재고객·연락)이 잡히면 한 단계 더 붙는다 — 픽셀에 그 이벤트를
   * 심는 순간 코드 수정 없이 흐름이 길어진다.
   */
  const funnel = useMemo(() => {
    const adByType = new Map(actions.ad.map((a) => [a.actionType, a]));
    const webByType = new Map(actions.web.map((w) => [w.actionType, w]));
    const steps: { label: string; value: number }[] = [
      { label: "노출", value: overall.impressions },
    ];
    for (const t of ["link_click"]) {
      const hit = adByType.get(t);
      if (hit) steps.push({ label: hit.label, value: hit.total });
    }
    for (const t of [
      "landing_page_view",
      "offsite_conversion.fb_pixel_view_content",
    ]) {
      const hit = webByType.get(t);
      if (hit) steps.push({ label: hit.label, value: hit.total });
    }
    const conversion =
      META_FUNNEL_WEB_STEP_PRIORITY.filter(
        (t) =>
          t !== "landing_page_view" &&
          t !== "offsite_conversion.fb_pixel_view_content",
      )
        .map((t) => webByType.get(t))
        .find((w) => w != null) ?? null;
    if (conversion)
      steps.push({ label: conversion.label, value: conversion.total });
    return steps;
  }, [actions.ad, actions.web, overall]);

  if (!bounds || daily.length === 0) {
    return <EmptyState status={status} showDiagnostics={showDiagnostics} />;
  }

  const setPreset = (preset: "all" | "1m") => {
    if (preset === "all") {
      setRangeStart(bounds.min);
      setRangeEnd(bounds.max);
      return;
    }
    const d = new Date(`${bounds.max}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() - 30);
    const from = d.toISOString().slice(0, 10);
    setRangeStart(from < bounds.min ? bounds.min : from);
    setRangeEnd(bounds.max);
  };

  return (
    <div className="flex flex-col gap-8">
      {/* 컨트롤 — 파워링크 탭과 동일 배치 */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-2">
          <label className="flex flex-col gap-0.5 text-xs text-[var(--text-muted)]">
            시작
            <input
              type="date"
              className="h-8 border border-[var(--border-strong)] bg-[var(--bg)] px-2 text-xs text-[var(--text)]"
              min={minB}
              max={maxB}
              value={start}
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
              value={end}
              onChange={(e) => setRangeEnd(e.target.value)}
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-1">
          {(
            [
              ["all", "전체(최대 6개월)"],
              ["1m", "최근 1개월"],
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
            ] as const
          ).map(([g, label]) => (
            <button
              key={g}
              type="button"
              onClick={() => setGranularity(g)}
              className={`cursor-pointer px-2.5 py-1 text-xs ${
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

      {/*
        요약 KPI — **도달(reach)은 넣지 않는다.** 도달은 중복을 제거한 사람 수라 일별 값을 더할 수
        없다(같은 사람이 10일에 걸쳐 봤으면 합계에서 10명이 된다). 실측에서 노출 68,342 · 일별 도달
        단순합 65,575 → 빈도 1.04 라는 불가능한 값이 나왔다. 올바른 기간 도달은 그 기간마다 Meta 에
        따로 물어야 얻어지므로(우리가 계산할 수 없다) 기간을 자유롭게 고르는 이 화면에서는 뺀다.
        일별 원시값은 DB 에 남아 있어(하루 단위로는 정확) 고정 기간 지표가 필요해지면 쓸 수 있다.
      */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiBox
          label="노출"
          value={formatMetric("impressions", overall.impressions)}
        />
        {/* "클릭"은 Meta 의 clicks(전체) — 유입 흐름의 "링크 클릭"(1,408)과 다른 값(1,554)이라
            이름으로 구분해 둔다. 좋아요·프로필 클릭 등이 함께 들어 있다. */}
        <KpiBox
          label="클릭(전체)"
          value={formatMetric("clicks", overall.clicks)}
        />
        <KpiBox
          label="클릭율"
          value={formatMetric("ctr", derive(overall, "ctr"))}
        />
        <KpiBox label="총비용" value={formatMetric("spend", overall.spend)} />
        <KpiBox
          label="CPC"
          value={formatMetric("cpc", derive(overall, "cpc"))}
        />
      </div>

      {/* 추세 — 지표 토글 */}
      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-[var(--text)]">
            광고 추세
          </h3>
          <div className="flex rounded border border-[var(--border-strong)] p-0.5">
            {METRICS.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setTrendMetric(m.key)}
                className={`cursor-pointer px-2.5 py-1 text-xs ${
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
          <ResponsiveContainer
            width="100%"
            height="100%"
            minWidth={0}
            minHeight={200}
          >
            <LineChart
              data={trend}
              margin={{ top: 8, right: 12, bottom: 8, left: 4 }}
            >
              <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
              <XAxis
                dataKey="label"
                stroke={AXIS}
                tick={{ fill: TICK, fontSize: 11 }}
                interval="preserveStartEnd"
                minTickGap={24}
              />
              <YAxis
                stroke={AXIS}
                tick={{ fill: TICK, fontSize: 11 }}
                tickFormatter={(v) => formatMetric(trendMetric, Number(v))}
                width={64}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                labelStyle={{ color: "var(--text)" }}
                formatter={(value) => [
                  formatMetric(
                    trendMetric,
                    typeof value === "number" ? value : Number(value),
                  ),
                  METRICS.find((m) => m.key === trendMetric)?.label ?? "",
                ]}
              />
              <Line
                type="monotone"
                dataKey="value"
                name={METRICS.find((m) => m.key === trendMetric)?.label ?? ""}
                stroke={SERIES}
                strokeWidth={2}
                dot={
                  granularity === "day"
                    ? false
                    : { r: 3, fill: SERIES, strokeWidth: 0 }
                }
                activeDot={{ r: 4 }}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* 광고별 성과 — 광고 반응 표를 유입 흐름에 합쳤으므로 이제 전체 폭을 쓴다. */}
      <section>
        <h3 className="mb-2 text-base font-semibold text-[var(--text)]">
          광고별 성과
        </h3>
        <div className="overflow-x-auto border border-[var(--border)]">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--bg-subtle)] text-[var(--text-secondary)]">
                {/* 헤더는 모두 좌측 정렬 — 값 셀은 숫자라 우측 정렬을 유지한다. */}
                <th className="py-2 pl-3 pr-2 font-medium">광고 / 캠페인</th>
                <th className="py-2 px-2 font-medium">노출</th>
                <th className="py-2 px-2 font-medium">클릭</th>
                <th className="py-2 px-2 font-medium">클릭율</th>
                <th className="py-2 px-2 font-medium">비용</th>
                <th className="py-2 pl-2 pr-3 font-medium">CPC</th>
              </tr>
            </thead>
            <tbody>
              {adTable.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="py-6 text-center text-[var(--text-muted)]"
                  >
                    선택 기간에 데이터가 없습니다.
                  </td>
                </tr>
              ) : (
                adTable.map((a, i) => (
                  <tr
                    key={i}
                    className="border-b border-[var(--border)] last:border-0"
                  >
                    <td className="py-2 pl-3 pr-2">
                      <div className="text-[var(--text)]">{a.name}</div>
                      <div className="text-[11px] text-[var(--text-muted)]">
                        {a.campaign}
                      </div>
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums">
                      {num(a.impressions)}
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums">
                      {num(a.clicks)}
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums">
                      {formatMetric("ctr", derive(a, "ctr"))}
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums">
                      {formatMetric("spend", a.spend)}
                    </td>
                    <td className="py-2 pl-2 pr-3 text-right tabular-nums">
                      {formatMetric("cpc", derive(a, "cpc"))}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 유입 흐름 — 광고(노출·링크 클릭)에서 웹사이트(랜딩·콘텐츠 조회)까지 한 줄로 잇는다. */}
      <section>
        <h3 className="mb-2 text-base font-semibold text-[var(--text)]">
          유입 흐름
        </h3>
        {/*
          해석 주의를 화면에 남긴다. 이 숫자만 보면 "광고가 실패했다"고 읽히지만, 전화·네이버 예약
          처럼 웹사이트를 거치지 않는 문의는 픽셀이 볼 수 없다. 그 한계를 적어두지 않으면 잘못된
          판단(광고 중단 등)으로 이어진다.
        */}
        <div className="mb-3 rounded-md border-l-2 border-[var(--accent)] bg-[var(--accent-subtle)] px-3 py-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">
          <b>노출·링크 클릭</b>은 인스타그램에서, <b>랜딩 페이지 조회부터</b>는
          웹사이트에 설치된 Meta 픽셀이 보고한 값입니다. 모두{" "}
          <b>인스타그램 광고로 유입된 방문</b>만 포함됩니다.
          <br />
          <b>전화·네이버 예약으로 직접 들어온 문의는 집계되지 않습니다</b> —
          실제 문의는 이 숫자보다 많을 수 있습니다.
        </div>
        {funnel.length < 2 ? (
          <p className="border border-[var(--border)] bg-[var(--bg)] py-6 text-center text-sm text-[var(--text-muted)]">
            표시할 유입 단계가 없습니다.
          </p>
        ) : (
          <div className="flex flex-col gap-2 border border-[var(--border)] p-4">
            {funnel.map((s, i) => {
              const prev = i > 0 ? funnel[i - 1].value : null;
              const rate = prev && prev > 0 ? (s.value / prev) * 100 : null;
              const width = (s.value / Math.max(funnel[0].value, 1)) * 100;
              return (
                <div key={s.label} className="flex items-center gap-3">
                  <span className="w-[100px] shrink-0 text-xs text-[var(--text-secondary)]">
                    {s.label}
                  </span>
                  <div className="h-6 min-w-[2px] flex-1 rounded-sm bg-[var(--bg-subtle)]">
                    <div
                      className="h-6 rounded-sm bg-[var(--accent)]"
                      style={{ width: `${Math.max(width, 0.4)}%` }}
                    />
                  </div>
                  <span className="w-[84px] shrink-0 text-right text-sm font-bold tabular-nums text-[var(--text)]">
                    {num(s.value)}
                  </span>
                  <span className="w-[60px] shrink-0 text-right text-xs tabular-nums text-[var(--text-muted)]">
                    {rate == null ? "" : `${rate.toFixed(1)}%`}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
