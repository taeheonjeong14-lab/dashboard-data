"use client";

import { useEffect, useMemo, useState } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { useHospital } from "@/components/hospital-dashboard/context";
import { CenteredSpinner } from "@/components/hospital-dashboard/spinner";
import {
  type HospitalManagementDayRow,
} from "@/lib/hospital-dashboard/types";
import {
  fetchHospitalManagementKpis,
  fetchVetCount,
} from "@/lib/hospital-dashboard/queries";
import {
  getDataBounds,
  pickMetric,
  type ManagementMetricKey,
} from "@/lib/hospital-dashboard/management-aggregates";
import ManagementMetricSection from "@/components/hospital-dashboard/ManagementMetricSection";

type LoadState = "loading" | "error" | "done";

type Props = {
  /** 행에서 읽을 지표 (sales/visits/newPatients) */
  metric: ManagementMetricKey;
  /** 라벨에 들어갈 지표명 (예: "매출", "진료건수") */
  metricLabel: string;
  /** 그래프용 포맷 */
  valueFormat: "currency" | "integer" | "decimal";
  valueSuffix?: string;
  /** 박스 값 포맷터 (예: 억/만원, N건) */
  format: (v: number | null) => string;
  /** 평균 지표(월평균·일평균·1인당) 전용 포맷터. 미지정 시 format 사용. */
  formatAvg?: (v: number | null) => string;
  /** 수의사 1인당 월평균 지표 표시 여부 (기본 true). */
  showPerVet?: boolean;
};

function seoulMonthKey(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" })
    .format(new Date())
    .slice(0, 7);
}


/** 상단 가로: 기간 무관 고정 핵심 지표 (존재감 있게). */
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
  return (
    <div className="rounded-md border border-[var(--accent)]/30 bg-[var(--accent-subtle)] px-4 py-3.5 shadow-sm">
      <div className="text-xs text-[var(--text-secondary)]">{label}</div>
      {tone ? (
        <div className="mt-1.5">
          <span
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xl font-bold tabular-nums"
            style={{
              color,
              backgroundColor: tone === "up" ? "rgba(22,163,74,0.12)" : "rgba(220,38,38,0.12)",
            }}
          >
            {tone === "up" ? (
              <TrendingUp size={16} strokeWidth={2.5} className="shrink-0" />
            ) : (
              <TrendingDown size={16} strokeWidth={2.5} className="shrink-0" />
            )}
            {value}
          </span>
        </div>
      ) : (
        <div className="mt-1.5 text-2xl font-bold tabular-nums text-[var(--text)]">{value}</div>
      )}
      {sub ? <div className="mt-0.5 text-xs text-[var(--text-muted)]">{sub}</div> : null}
    </div>
  );
}

/** 그래프 우측 패널의 한 줄(지표). */
function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-1 flex-col justify-center px-3 py-2">
      <div className="text-[11px] leading-tight text-[var(--text-muted)]">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-[var(--text)]">{value}</div>
    </div>
  );
}

export default function ManagementMetricDashboard({
  metric,
  metricLabel,
  valueFormat,
  valueSuffix,
  format,
  formatAvg,
  showPerVet = true,
}: Props) {
  const fmtAvg = formatAvg ?? format;
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [rows, setRows] = useState<HospitalManagementDayRow[]>([]);
  const [vetCount, setVetCount] = useState<number | null>(null);
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
        const [data, vc] = await Promise.all([
          fetchHospitalManagementKpis(hid),
          fetchVetCount(hid),
        ]);
        if (!cancelled) {
          setHospitalId(hid);
          setRows(data);
          setVetCount(vc);
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

  // 기간 무관 고정 지표: 최근 종료월 / 전월 대비 / 전년 동월 대비 / YTD
  const fixed = useMemo(() => {
    const months = rows
      .filter((r) => r.periodType === "month" && pickMetric(r, metric) != null)
      .map((r) => ({ key: r.dateKey.slice(0, 7), v: pickMetric(r, metric) as number }))
      .sort((a, b) => (a.key < b.key ? -1 : 1));
    const curKey = seoulMonthKey();
    const completed = months.filter((m) => m.key < curKey);
    const ref = completed.length ? completed[completed.length - 1] : null;
    if (!ref) {
      return {
        refLabel: `최근 월 ${metricLabel}`,
        monthLabel: undefined as string | undefined,
        refVal: null as number | null,
        momPct: null as number | null,
        yoyPct: null as number | null,
        ytd: null as number | null,
        ytdSub: undefined as string | undefined,
      };
    }
    const [ry, rm] = ref.key.split("-").map(Number);
    const pmM = rm === 1 ? 12 : rm - 1;
    const pmY = rm === 1 ? ry - 1 : ry;
    const prevMonthKey = `${pmY}-${String(pmM).padStart(2, "0")}`;
    const prevMonth = months.find((m) => m.key === prevMonthKey)?.v ?? null;
    const momPct =
      prevMonth != null && prevMonth > 0 ? ((ref.v - prevMonth) / prevMonth) * 100 : null;
    const prevKey = `${ry - 1}-${String(rm).padStart(2, "0")}`;
    const prev = months.find((m) => m.key === prevKey)?.v ?? null;
    const yoyPct = prev != null && prev > 0 ? ((ref.v - prev) / prev) * 100 : null;
    const ytd = months
      .filter((m) => m.key.startsWith(`${ry}-`) && m.key <= ref.key)
      .reduce((acc, m) => acc + m.v, 0);
    return {
      refLabel: `${ry}년 ${rm}월 ${metricLabel}`,
      monthLabel: `${rm}월`,
      refVal: ref.v,
      momPct,
      yoyPct,
      ytd,
      ytdSub: `${ry}년 1~${rm}월 누적`,
    };
  }, [rows, metric, metricLabel]);

  // 선택 기간 연동 지표: 총합 / 월 평균 / 수의사 1인당 월 평균 / 일 평균
  const periodKpis = useMemo(() => {
    const s = rangeStart || minB;
    const e = rangeEnd || maxB;
    const months = rows.filter(
      (r) =>
        r.periodType === "month" &&
        pickMetric(r, metric) != null &&
        r.dateKey >= s &&
        r.dateKey <= e,
    );
    const monthCount = months.length;
    const total = months.reduce((acc, r) => acc + (pickMetric(r, metric) ?? 0), 0);
    const monthlyAvg = monthCount > 0 ? total / monthCount : null;
    const perVet =
      monthlyAvg != null && vetCount != null && vetCount > 0 ? monthlyAvg / vetCount : null;
    // 일 평균: 값이 0인 날(휴무)은 모수에서 제외.
    const operatingDays = rows.filter((r) => {
      const v = pickMetric(r, metric);
      return r.periodType === "day" && v != null && v > 0 && r.dateKey >= s && r.dateKey <= e;
    });
    const dayTotal = operatingDays.reduce((acc, r) => acc + (pickMetric(r, metric) ?? 0), 0);
    const dailyAvg = operatingDays.length > 0 ? dayTotal / operatingDays.length : null;
    return { total: monthCount > 0 ? total : null, monthlyAvg, perVet, dailyAvg };
  }, [rows, metric, rangeStart, rangeEnd, minB, maxB, vetCount]);

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

  const pct = (p: number | null) =>
    p == null ? "—" : `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`;
  const tone = (p: number | null): "up" | "down" | undefined =>
    p == null ? undefined : p >= 0 ? "up" : "down";

  const trendAside = (
    <div className="flex h-full flex-col overflow-hidden rounded-md border border-[var(--border)] bg-[var(--bg)] shadow-sm">
      <div className="border-b border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-1.5 text-[11px] font-medium text-[var(--text-secondary)]">
        선택 기간 지표
      </div>
      <div className="flex flex-1 flex-col divide-y divide-[var(--border)]">
        <StatRow label={`총 ${metricLabel}`} value={format(periodKpis.total)} />
        <StatRow label={`월 평균 ${metricLabel}`} value={fmtAvg(periodKpis.monthlyAvg)} />
        {showPerVet ? (
          <StatRow label={`수의사 1인당 월평균 ${metricLabel}`} value={fmtAvg(periodKpis.perVet)} />
        ) : null}
        <StatRow label={`일 평균 ${metricLabel}`} value={fmtAvg(periodKpis.dailyAvg)} />
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* 상단 가로: 고정 핵심 지표 (기간 무관) */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FixedKpiBox label={fixed.refLabel} value={format(fixed.refVal)} />
        <FixedKpiBox
          label="전월 대비"
          value={pct(fixed.momPct)}
          tone={tone(fixed.momPct)}
          sub={fixed.monthLabel ? `${fixed.monthLabel} 기준` : undefined}
        />
        <FixedKpiBox
          label="전년 동월 대비"
          value={pct(fixed.yoyPct)}
          tone={tone(fixed.yoyPct)}
          sub={fixed.monthLabel ? `${fixed.monthLabel} 기준` : undefined}
        />
        <FixedKpiBox
          label={`올해 누적 ${metricLabel} (YTD)`}
          value={format(fixed.ytd)}
          sub={fixed.ytdSub}
        />
      </div>

      {/* 그래프 + (추이 우측) 선택 기간 KPI */}
      <ManagementMetricSection
        title={metricLabel}
        rows={rows}
        metric={metric}
        valueFormat={valueFormat}
        valueSuffix={valueSuffix}
        hideHeader
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        onRangeStartChange={setRangeStart}
        onRangeEndChange={setRangeEnd}
        trendAside={trendAside}
      />
    </div>
  );
}
