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

export default function VisitsDashboardPage() {
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
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <ManagementMetricSection
          title="진료 건수"
          rows={rows}
          metric="visits"
          valueFormat="integer"
          valueSuffix="건"
          hideHeader
        />
      </div>
    </div>
  );
}
