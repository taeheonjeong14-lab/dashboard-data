"use client";

import ManagementMetricDashboard from "@/components/dashboard/ManagementMetricDashboard";

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

export default function SalesDashboardPage() {
  return (
    <ManagementMetricDashboard
      metric="sales"
      metricLabel="매출"
      valueFormat="currency"
      format={formatWon}
    />
  );
}
