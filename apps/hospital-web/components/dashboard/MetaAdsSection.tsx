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
  type MetaActionTotal,
} from "@dashboard/meta-ads-metrics";
import type { MetaAdsConversionRow, MetaAdsDailyRow, MetaAdsStatus } from "@/lib/queries";

/**
 * 차트는 CSS 변수를 그대로 SVG 속성에 넘겨 다크 모드를 따라간다.
 * (기존 SearchAdSection 은 #ffffff 등을 하드코딩해 다크에서 어긋난다 — 여기선 반복하지 않는다.)
 */
const AXIS = "var(--border-strong)";
const GRID = "var(--border)";
const TICK = "var(--text-muted)";
const SERIES = "var(--accent)";

const tooltipContentStyle = {
  backgroundColor: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: "8px",
  fontSize: "12px",
};

function num(v: number): string {
  return Math.round(v).toLocaleString("ko-KR");
}
function won(v: number): string {
  return `${Math.round(v).toLocaleString("ko-KR")}원`;
}
function pct(v: number): string {
  return `${v.toFixed(2)}%`;
}

type Tab = "ads" | "web";

/**
 * 일별 추이는 **패널을 나눠** 그린다. 노출(수만)·클릭(수천)·지출(수십만)은 척도가 44배까지
 * 벌어져서 한 그림에 겹치면(또는 이중축으로 두면) 작은 계열이 바닥에 붙어 읽히지 않는다.
 * 시리즈가 하나뿐이라 범례도 필요 없다 — 제목이 그 역할을 한다.
 */
function TrendPanel({
  title,
  points,
  dataKey,
  format,
}: {
  title: string;
  points: { date: string; value: number }[];
  dataKey: string;
  format: (v: number) => string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-[var(--text-secondary)]">{title}</span>
      <div className="h-[140px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 6, right: 10, bottom: 2, left: 2 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              stroke={AXIS}
              tick={{ fill: TICK, fontSize: 10 }}
              tickFormatter={(d: string) => d.slice(5)}
              minTickGap={24}
            />
            <YAxis
              stroke={AXIS}
              tick={{ fill: TICK, fontSize: 10 }}
              width={48}
              tickFormatter={(v: number) => (v >= 10000 ? `${Math.round(v / 1000)}k` : String(v))}
            />
            <Tooltip
              contentStyle={tooltipContentStyle}
              labelStyle={{ color: "var(--text)" }}
              formatter={(v) => [format(Number(v)), title]}
            />
            <Line
              type="monotone"
              dataKey={dataKey}
              name={title}
              stroke={SERIES}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function KpiTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border border-[var(--border)] bg-[var(--bg)] p-3">
      <div className="text-xs text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 text-lg font-bold text-[var(--text)]">{value}</div>
      {sub ? <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">{sub}</div> : null}
    </div>
  );
}

function ActionTable({ rows, note }: { rows: MetaActionTotal[]; note?: string }) {
  if (rows.length === 0) {
    return <p className="text-sm text-[var(--text-muted)]">해당 기간에 집계된 항목이 없습니다.</p>;
  }
  const max = Math.max(...rows.map((r) => r.total), 1);
  return (
    <div className="flex flex-col gap-2">
      {note ? <p className="text-[11px] text-[var(--text-muted)]">{note}</p> : null}
      <table className="w-full text-sm">
        <tbody>
          {rows.map((r) => (
            <tr key={r.actionType} className="border-b border-[var(--border)]">
              <td className="py-1.5 pr-3 text-[var(--text-secondary)]">
                {r.label}
                {r.negative ? (
                  <span className="ml-1 text-[11px] text-[var(--danger,#dc2626)]">부정 신호</span>
                ) : null}
                {r.custom ? (
                  <span className="ml-1 text-[11px] text-[var(--text-muted)]">커스텀</span>
                ) : null}
              </td>
              {/* 막대 길이로 크기를 표현한다 — 색으로 서열을 표현하지 않는다. */}
              <td className="w-[45%] py-1.5">
                <div className="h-1.5 w-full bg-[var(--bg-subtle,#f1f3f5)]">
                  <div
                    className="h-1.5 bg-[var(--accent)]"
                    style={{ width: `${(r.total / max) * 100}%` }}
                  />
                </div>
              </td>
              <td className="py-1.5 pl-3 text-right font-semibold tabular-nums text-[var(--text)]">
                {num(r.total)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 데이터가 한 행도 없을 때의 안내. 세 경우를 구분한다 — 한 문장으로 덮으면
 * ①광고를 안 하는 병원 ②연동 누락 ③첫 수집 전 이 섞여, 연동이 빠진 병원이 조용히 방치된다.
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
    body = "광고를 시작하셨다면 담당자에게 알려주세요. 연동 후 성과가 이 화면에 표시됩니다.";
  } else if (!synced) {
    title = "연동이 완료되었습니다";
    body = "첫 수집 후(보통 1일 이내) 데이터가 표시됩니다.";
  } else {
    title = "표시할 광고 데이터가 없습니다";
    body = "연동은 되어 있지만 최근 6개월 안에 집행된 광고가 없습니다.";
  }

  return (
    <div className="border border-[var(--border)] bg-[var(--bg)] p-4">
      <p className="text-sm font-semibold text-[var(--text)]">{title}</p>
      <p className="mt-1 text-sm text-[var(--text-muted)]">{body}</p>
      {showDiagnostics ? (
        <p className="mt-2 text-[11px] text-[var(--text-muted)]">
          광고계정 {status?.adAccountId || "미지정"} · 수집 사용 {status?.isActive ? "ON" : "OFF"} ·
          마지막 수집{" "}
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
  const [tab, setTab] = useState<Tab>("ads");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");

  const bounds = useMemo(() => {
    const dates = daily.map((d) => d.metricDate).filter(Boolean).sort();
    if (dates.length === 0) return null;
    return { min: dates[0], max: dates[dates.length - 1] };
  }, [daily]);

  const start = rangeStart || bounds?.min || "";
  const end = rangeEnd || bounds?.max || "";

  const inRange = (d: string) => (!start || d >= start) && (!end || d <= end);
  const rows = useMemo(() => daily.filter((r) => inRange(r.metricDate)), [daily, start, end]);
  const convRows = useMemo(
    () => conversions.filter((r) => inRange(r.metricDate)),
    [conversions, start, end],
  );

  const totals = useMemo(() => {
    let impressions = 0;
    let clicks = 0;
    let spend = 0;
    let reach = 0;
    for (const r of rows) {
      impressions += r.impressions;
      clicks += r.clicks;
      spend += r.spend;
      reach += r.reach;
    }
    return { impressions, clicks, spend, reach };
  }, [rows]);

  // 일별 합산 (여러 광고가 같은 날짜에 있으므로 날짜로 접는다)
  const trend = useMemo(() => {
    const byDate = new Map<string, { impressions: number; clicks: number; spend: number }>();
    for (const r of rows) {
      const cur = byDate.get(r.metricDate) ?? { impressions: 0, clicks: 0, spend: 0 };
      cur.impressions += r.impressions;
      cur.clicks += r.clicks;
      cur.spend += r.spend;
      byDate.set(r.metricDate, cur);
    }
    return [...byDate.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([date, v]) => ({ date, ...v }));
  }, [rows]);

  const actions = useMemo(() => summarizeMetaActions(convRows), [convRows]);

  // 광고별 표 (지출 내림차순)
  const adTable = useMemo(() => {
    const byAd = new Map<
      string,
      { name: string; campaign: string; impressions: number; clicks: number; spend: number }
    >();
    for (const r of rows) {
      const key = r.adId || r.adName || "(알 수 없음)";
      const cur =
        byAd.get(key) ??
        {
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

  // 깔때기 — 노출 → 클릭 → 랜딩 도달 → 대표 웹 전환
  const funnel = useMemo(() => {
    const webByType = new Map(actions.web.map((w) => [w.actionType, w]));
    const landing = webByType.get("landing_page_view")?.total ?? null;
    const finalStep =
      META_FUNNEL_WEB_STEP_PRIORITY.map((t) => webByType.get(t)).find((w) => w != null) ?? null;
    const steps: { label: string; value: number }[] = [
      { label: "노출", value: totals.impressions },
      { label: "클릭", value: totals.clicks },
    ];
    if (landing != null) steps.push({ label: "랜딩페이지 도달", value: landing });
    if (finalStep) steps.push({ label: finalStep.label, value: finalStep.total });
    return steps;
  }, [actions.web, totals]);

  if (!bounds || daily.length === 0) {
    return <EmptyState status={status} showDiagnostics={showDiagnostics} />;
  }

  const setPreset = (preset: "all" | "1m") => {
    if (preset === "all") {
      setRangeStart("");
      setRangeEnd("");
      return;
    }
    const d = new Date(`${bounds.max}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() - 29);
    const from = d.toISOString().slice(0, 10);
    setRangeStart(from < bounds.min ? bounds.min : from);
    setRangeEnd(bounds.max);
  };

  const ctr = (totals.clicks / Math.max(totals.impressions, 1)) * 100;
  const cpc = totals.spend / Math.max(totals.clicks, 1);

  return (
    <div className="flex flex-col gap-6">
      {/* 기간 */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-0.5 text-xs text-[var(--text-muted)]">
          시작
          <input
            type="date"
            className="h-8 border border-[var(--border-strong)] bg-[var(--bg)] px-2 text-xs text-[var(--text)]"
            min={bounds.min}
            max={bounds.max}
            value={start}
            onChange={(e) => setRangeStart(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-0.5 text-xs text-[var(--text-muted)]">
          종료
          <input
            type="date"
            className="h-8 border border-[var(--border-strong)] bg-[var(--bg)] px-2 text-xs text-[var(--text)]"
            min={bounds.min}
            max={bounds.max}
            value={end}
            onChange={(e) => setRangeEnd(e.target.value)}
          />
        </label>
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
      </div>

      {/* 탭 */}
      <div className="flex border-b border-[var(--border)]" role="tablist">
        {(
          [
            ["ads", "광고 성과"],
            ["web", "웹사이트 전환"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`cursor-pointer px-3 py-2 text-sm ${
              tab === key
                ? "border-b-2 border-[var(--accent)] font-semibold text-[var(--accent)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 기간 필터로 0행이 된 경우 — 기간 컨트롤은 남겨 둔다(넓혀서 복구할 수 있게). */}
      {rows.length === 0 ? (
        <p className="border border-[var(--border)] bg-[var(--bg)] p-4 text-sm text-[var(--text-muted)]">
          선택한 기간에 집행된 광고가 없습니다. 기간을 넓혀 보세요.
        </p>
      ) : tab === "ads" ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <KpiTile label="노출" value={num(totals.impressions)} />
            <KpiTile label="도달" value={num(totals.reach)} sub="중복 없는 사람 수" />
            <KpiTile label="클릭" value={num(totals.clicks)} />
            <KpiTile label="CTR" value={pct(ctr)} sub="클릭 ÷ 노출" />
            <KpiTile label="지출" value={won(totals.spend)} />
            <KpiTile label="CPC" value={won(cpc)} sub="클릭당 비용" />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <TrendPanel title="일별 노출" points={trend.map((t) => ({ date: t.date, value: t.impressions }))} dataKey="value" format={num} />
            <TrendPanel title="일별 클릭" points={trend.map((t) => ({ date: t.date, value: t.clicks }))} dataKey="value" format={num} />
            <TrendPanel title="일별 지출" points={trend.map((t) => ({ date: t.date, value: t.spend }))} dataKey="value" format={won} />
          </div>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-bold text-[var(--text)]">광고 반응</h3>
            <ActionTable
              rows={actions.ad}
              note="게시물 참여는 링크 클릭·반응·저장을 모두 포함하는 상위 개념입니다. 링크 클릭과 나란히 보세요."
            />
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-bold text-[var(--text)]">광고별 성과</h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--text-muted)]">
                    <th className="py-1.5 pr-3 font-medium">광고</th>
                    <th className="py-1.5 pr-3 font-medium">캠페인</th>
                    <th className="py-1.5 pr-3 text-right font-medium">노출</th>
                    <th className="py-1.5 pr-3 text-right font-medium">클릭</th>
                    <th className="py-1.5 pr-3 text-right font-medium">CTR</th>
                    <th className="py-1.5 pr-3 text-right font-medium">지출</th>
                    <th className="py-1.5 text-right font-medium">CPC</th>
                  </tr>
                </thead>
                <tbody>
                  {adTable.map((a, i) => (
                    <tr key={i} className="border-b border-[var(--border)]">
                      <td className="py-1.5 pr-3 text-[var(--text)]">{a.name}</td>
                      <td className="py-1.5 pr-3 text-[var(--text-secondary)]">{a.campaign}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{num(a.impressions)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{num(a.clicks)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">
                        {pct((a.clicks / Math.max(a.impressions, 1)) * 100)}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{won(a.spend)}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {won(a.spend / Math.max(a.clicks, 1))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <>
          <p className="border-l-2 border-[var(--accent)] bg-[var(--bg-subtle,#f8f9fa)] px-3 py-2 text-xs text-[var(--text-secondary)]">
            <b>인스타그램 광고로 유입된 방문 기준</b>입니다. 웹사이트에 설치된 Meta 픽셀이 보고한
            값이고, 광고를 보지 않고 들어온 방문은 포함되지 않습니다.
          </p>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-bold text-[var(--text)]">유입 깔때기</h3>
            {funnel.length < 3 ? (
              <p className="text-sm text-[var(--text-muted)]">
                픽셀 데이터가 없어 깔때기를 그릴 수 없습니다.
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {funnel.map((s, i) => {
                  const prev = i > 0 ? funnel[i - 1].value : null;
                  const rate = prev && prev > 0 ? (s.value / prev) * 100 : null;
                  const width = (s.value / Math.max(funnel[0].value, 1)) * 100;
                  return (
                    <div key={s.label} className="flex items-center gap-3">
                      <span className="w-[110px] shrink-0 text-xs text-[var(--text-secondary)]">
                        {s.label}
                      </span>
                      <div className="h-5 min-w-[2px] flex-1 bg-[var(--bg-subtle,#f1f3f5)]">
                        <div
                          className="h-5 bg-[var(--accent)]"
                          style={{ width: `${Math.max(width, 0.4)}%` }}
                        />
                      </div>
                      <span className="w-[80px] shrink-0 text-right text-sm font-semibold tabular-nums text-[var(--text)]">
                        {num(s.value)}
                      </span>
                      <span className="w-[64px] shrink-0 text-right text-xs tabular-nums text-[var(--text-muted)]">
                        {rate == null ? "" : `${rate.toFixed(1)}%`}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-bold text-[var(--text)]">웹사이트 전환</h3>
            <ActionTable rows={actions.web} />
          </section>

          {actions.custom.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-bold text-[var(--text)]">커스텀 전환</h3>
              <ActionTable
                rows={actions.custom}
                note="Meta 이벤트 관리자에 직접 만든 전환입니다. 이름을 임의로 번역하지 않고 원문 그대로 표시합니다 — 실제로 무엇을 세는지는 이벤트 설정을 확인하세요."
              />
            </section>
          )}
        </>
      )}
    </div>
  );
}
