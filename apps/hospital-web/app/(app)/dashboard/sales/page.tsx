"use client";

import { useEffect, useMemo, useState } from "react";
import { useHospital } from "@/components/shell/hospital-context";
import { CenteredSpinner } from "@/components/ui/loading-spinner";
import {
  fetchHospitalManagementKpis,
  type HospitalManagementDayRow,
} from "@/lib/queries";
import { getDataBounds } from "@/lib/management-aggregates";
import ManagementMetricSection from "@/components/dashboard/ManagementMetricSection";

type LoadState = "loading" | "error" | "done";

/** 매출 금액을 읽기 쉬운 단위로(억/만원). */
function formatWon(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const won = Math.round(v);
  if (Math.abs(won) >= 1e8)
    return `${(won / 1e8).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}억원`;
  if (Math.abs(won) >= 1e4)
    return `${Math.round(won / 1e4).toLocaleString("ko-KR")}만원`;
  return `${won.toLocaleString("ko-KR")}원`;
}

function seoulMonthKey(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" })
    .format(new Date())
    .slice(0, 7);
}

function addDaysToDateKey(dateKey: string, delta: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + delta * 86400000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function FixedKpiBox({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: string;
  tone?: "up" | "down";
  sub?: string;
}) {
  const color = tone === "up" ? "#16a34a" : tone === "down" ? "#dc2626" : "var(--text)";
  const arrow = tone === "up" ? "▲" : tone === "down" ? "▼" : "";
  return (
    <div className="rounded-md border border-[var(--accent)]/20 bg-[var(--accent-subtle)] px-4 py-3.5">
      <div className="text-xs text-[var(--text-secondary)]">{label}</div>
      <div className="mt-1.5 text-2xl font-bold tabular-nums" style={{ color }}>
        {arrow ? <span className="mr-1 text-xl">{arrow}</span> : null}
        {value}
      </div>
      {sub ? <div className="mt-0.5 text-xs text-[var(--text-muted)]">{sub}</div> : null}
    </div>
  );
}

export default function SalesDashboardPage() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [rows, setRows] = useState<HospitalManagementDayRow[]>([]);
  const [rangeStart, setRangeStart] = useState<string>("");
  const [rangeEnd, setRangeEnd] = useState<string>("");

  const { hospitalId: ctxHospitalId } = useHospital();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const hid = ctxHospitalId;
        if (!hid) {
          if (!cancelled) {
            setHospitalId(null);
            setLoadState("done");
          }
          return;
        }
        const data = await fetchHospitalManagementKpis(hid);
        if (!cancelled) {
          setHospitalId(hid);
          setRows(data);
          setLoadState("done");
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "데이터를 불러오는 중 오류가 발생했습니다."
          );
          setLoadState("error");
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [ctxHospitalId]);

  const bounds = useMemo(() => getDataBounds(rows), [rows]);
  const minB = bounds?.min ?? "";
  const maxB = bounds?.max ?? "";

  // 기간 무관 고정 지표: 최근 종료월 매출 / 전년 동월 대비 / 올해 누적(YTD)
  const fixed = useMemo(() => {
    const months = rows
      .filter((r) => r.periodType === "month" && r.sales != null)
      .map((r) => ({ key: r.dateKey.slice(0, 7), sales: r.sales as number }))
      .sort((a, b) => (a.key < b.key ? -1 : 1));
    const curKey = seoulMonthKey();
    const completed = months.filter((m) => m.key < curKey);
    const ref = completed.length ? completed[completed.length - 1] : null;
    if (!ref) {
      return {
        refLabel: "최근 월 매출",
        monthLabel: undefined as string | undefined,
        refSales: null,
        yoyPct: null,
        ytd: null,
        ytdSub: undefined as string | undefined,
      };
    }
    const [ry, rm] = ref.key.split("-").map(Number);
    const prevKey = `${ry - 1}-${String(rm).padStart(2, "0")}`;
    const prev = months.find((m) => m.key === prevKey)?.sales ?? null;
    const yoyPct = prev != null && prev > 0 ? ((ref.sales - prev) / prev) * 100 : null;
    const ytd = months
      .filter((m) => m.key.startsWith(`${ry}-`) && m.key <= ref.key)
      .reduce((acc, m) => acc + m.sales, 0);
    return {
      refLabel: `${rm}월 매출`,
      monthLabel: `${rm}월`,
      refSales: ref.sales,
      yoyPct,
      ytd,
      ytdSub: `${ry}년 1~${rm}월 누적`,
    };
  }, [rows]);

  if (loadState === "loading") {
    return <CenteredSpinner minHeight="60vh" />;
  }

  if (loadState === "error") {
    return (
      <div
        style={{
          margin: "24px",
          padding: "16px",
          border: "1px solid var(--danger)",
          borderRadius: "var(--radius)",
          background: "var(--danger-subtle)",
          color: "var(--danger)",
          fontSize: "14px",
        }}
      >
        {error ?? "알 수 없는 오류"}
      </div>
    );
  }

  if (!hospitalId) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "300px",
          color: "var(--text-muted)",
          fontSize: "14px",
        }}
      >
        병원 정보가 없습니다. 관리자에게 문의하세요.
      </div>
    );
  }

  const yoyValue =
    fixed.yoyPct == null
      ? "—"
      : `${fixed.yoyPct >= 0 ? "+" : ""}${fixed.yoyPct.toFixed(1)}%`;
  const yoyTone =
    fixed.yoyPct == null ? undefined : fixed.yoyPct >= 0 ? "up" : "down";

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

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_8fr]">
      {/* 좌측 레일: 기간 선택기 + 고정 핵심 지표 */}
      <aside className="flex flex-col gap-3">
        {bounds && (
          <div className="flex flex-col gap-2 rounded-md border border-[var(--border)] bg-[var(--bg)] p-3">
            <div className="flex flex-wrap gap-2">
              <label className="flex flex-1 flex-col gap-0.5 text-xs text-[var(--text-muted)]">
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
              <label className="flex flex-1 flex-col gap-0.5 text-xs text-[var(--text-muted)]">
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
                  className="h-8 flex-1 cursor-pointer border border-[var(--border-strong)] bg-[var(--bg)] px-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        <FixedKpiBox label={fixed.refLabel} value={formatWon(fixed.refSales)} />
        <FixedKpiBox
          label="전년 동월 대비"
          value={yoyValue}
          tone={yoyTone}
          sub={fixed.monthLabel ? `${fixed.monthLabel} 기준` : undefined}
        />
        <FixedKpiBox label="올해 누적 매출 (YTD)" value={formatWon(fixed.ytd)} sub={fixed.ytdSub} />
      </aside>

      {/* 우측: 매출 그래프(레일 기간 선택을 따름) */}
      <div>
        <ManagementMetricSection
          title="매출"
          rows={rows}
          metric="sales"
          valueFormat="currency"
          hideHeader
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          onRangeStartChange={setRangeStart}
          onRangeEndChange={setRangeEnd}
          hideRangeControls
        />
      </div>
    </div>
  );
}
