"use client";

import ManagementMetricDashboard from "@/components/hospital-dashboard/ManagementMetricDashboard";

function formatPeople(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Math.round(v).toLocaleString("ko-KR")}명`;
}

function formatPeopleAvg(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}명`;
}

export default function PatientsDashboardPage() {
  return (
    <ManagementMetricDashboard
      metric="newPatients"
      metricLabel="신규환자"
      valueFormat="integer"
      valueSuffix="명"
      format={formatPeople}
      formatAvg={formatPeopleAvg}
      showPerVet={false}
    />
  );
}
