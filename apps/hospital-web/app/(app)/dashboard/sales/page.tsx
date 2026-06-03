"use client";

import { useEffect, useMemo, useState } from "react";
import { useHospital } from "@/components/shell/hospital-context";
import { CenteredSpinner } from "@/components/ui/loading-spinner";
import {
  fetchHospitalManagementKpis,
  type HospitalManagementDayRow,
} from "@/lib/queries";
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

async function fetchVetCount(): Promise<number | null> {
  try {
    const res = await fetch("/api/settings/hospital");
    if (!res.ok) return null;
    const data = (await res.json()) as { hospital?: { vetCount?: number | null } | null };
    return data.hospital?.vetCount ?? null;
  } catch {
    return null;
  }
}

function SalesKpiBox({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-[var(--accent)]/20 bg-[var(--accent-subtle)] px-4 py-3.5">
      <div className="text-xs text-[var(--text-secondary)]">{label}</div>
      <div className="mt-1.5 text-2xl font-bold tabular-nums text-[var(--text)]">{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-[var(--text-muted)]">{sub}</div> : null}
    </div>
  );
}

export default function SalesDashboardPage() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [rows, setRows] = useState<HospitalManagementDayRow[]>([]);
  const [vetCount, setVetCount] = useState<number | null>(null);

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
          fetchVetCount(),
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

  // 월 단위 행으로 총 매출·월 평균·수의사 1인당 월 평균을 계산한다.
  const kpis = useMemo(() => {
    const monthRows = rows.filter((r) => r.periodType === "month" && r.sales != null);
    const monthCount = monthRows.length;
    const total = monthRows.reduce((acc, r) => acc + (r.sales ?? 0), 0);
    const monthlyAvg = monthCount > 0 ? total / monthCount : null;
    const perVetMonthly =
      monthlyAvg != null && vetCount != null && vetCount > 0 ? monthlyAvg / vetCount : null;
    return {
      total: monthCount > 0 ? total : null,
      monthlyAvg,
      monthCount,
      perVetMonthly,
    };
  }, [rows, vetCount]);

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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SalesKpiBox
          label="총 매출"
          value={formatWon(kpis.total)}
          sub={kpis.monthCount > 0 ? `${kpis.monthCount}개월 합계` : undefined}
        />
        <SalesKpiBox label="월 평균 매출" value={formatWon(kpis.monthlyAvg)} />
        <SalesKpiBox
          label="수의사 1인 평균 월 매출"
          value={formatWon(kpis.perVetMonthly)}
          sub={
            vetCount != null && vetCount > 0
              ? `수의사 ${vetCount}명 기준`
              : "병원 설정에서 수의사 수를 입력해 주세요"
          }
        />
      </div>

      <ManagementMetricSection
        title="매출"
        rows={rows}
        metric="sales"
        valueFormat="currency"
        hideHeader
      />
    </div>
  );
}
