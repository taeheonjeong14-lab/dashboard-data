"use client";

import ManagementMetricDashboard from "@/components/hospital-dashboard/ManagementMetricDashboard";

function formatCount(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Math.round(v).toLocaleString("ko-KR")}건`;
}

function formatCountAvg(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}건`;
}

export default function VisitsDashboardPage() {
  return (
    <ManagementMetricDashboard
      metric="visits"
      metricLabel="진료건수"
      valueFormat="integer"
      valueSuffix="건"
      format={formatCount}
      formatAvg={formatCountAvg}
    />
  );
}
