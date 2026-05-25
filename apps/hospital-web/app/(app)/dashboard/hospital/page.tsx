"use client";

import { useEffect, useState } from "react";
import { useHospital } from "@/components/shell/hospital-context";
import { CenteredSpinner } from "@/components/ui/loading-spinner";
import {
  fetchHospitalManagementKpis,
  type HospitalManagementDayRow,
} from "@/lib/queries";
import ManagementMetricSection from "@/components/dashboard/ManagementMetricSection";

type LoadState = "loading" | "error" | "done";

export default function HospitalDashboardPage() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [rows, setRows] = useState<HospitalManagementDayRow[]>([]);

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
    <div>
      <div style={{ padding: "20px 20px 8px" }}>
        <h1
          style={{
            fontSize: "16px",
            fontWeight: 700,
            color: "var(--text)",
            margin: 0,
          }}
        >
          경영 통계
        </h1>
        <p
          style={{
            marginTop: "4px",
            fontSize: "13px",
            color: "var(--text-secondary)",
          }}
        >
          일별·월별·연별 매출, 내원 건수, 신규 고객 추이를 분석합니다.
        </p>
      </div>

      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          overflow: "hidden",
          margin: "0 20px 24px",
        }}
      >
        <ManagementMetricSection
          title="매출"
          description="일별·월별·연별 매출 추이입니다."
          rows={rows}
          metric="sales"
          valueFormat="currency"
        />
        <ManagementMetricSection
          title="내원 건수"
          description="진료 내원 건수 추이입니다."
          rows={rows}
          metric="visits"
          valueFormat="integer"
          valueSuffix="건"
        />
        <ManagementMetricSection
          title="신규 고객"
          description="신규 고객 수 추이입니다."
          rows={rows}
          metric="newPatients"
          valueFormat="integer"
          valueSuffix="명"
        />
      </div>
    </div>
  );
}
