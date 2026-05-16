"use client";

import { useEffect, useState } from "react";
import ManagementMetricSection from "@/components/management/ManagementMetricSection";
import { useAuth } from "@/lib/auth-context";
import {
  fetchHospitalManagementKpis,
  type HospitalManagementDayRow,
} from "@/lib/queries";

export default function HospitalManagementPage() {
  const { scope } = useAuth();
  const hospitalId = scope.assignedHospitalId;

  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<HospitalManagementDayRow[]>([]);

  useEffect(() => {
    if (!hospitalId) {
      setError("users.hospital_id 배정이 없어 경영 통계를 불러올 수 없습니다.");
      setRows([]);
      setReady(true);
      setLoading(false);
      return;
    }

    let active = true;
    const load = async (kind: "initial" | "refresh") => {
      try {
        const data = await fetchHospitalManagementKpis(hospitalId);
        if (!active) return;
        setRows(data);
        setError(null);
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : "데이터를 불러오지 못했습니다.");
        setRows([]);
      } finally {
        if (!active) return;
        if (kind === "initial") {
          setLoading(false);
          setReady(true);
        }
      }
    };

    void load("initial");

    const refresh = () => {
      if (!active) return;
      void load("refresh");
    };
    const interval = window.setInterval(refresh, 15000);
    const onFocus = () => refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [hospitalId]);

  if (!ready) {
    return (
      <main className="flex min-h-[40vh] items-center justify-center px-4">
        <p className="text-sm text-zinc-400">데이터 준비 중…</p>
      </main>
    );
  }

  return (
    <main className="w-full max-w-none px-4 py-4 sm:px-5 sm:py-5 lg:px-6">
      {loading && <p className="mb-2 text-sm text-zinc-500">불러오는 중…</p>}

      <div className="flex flex-col divide-y divide-zinc-800">
        <ManagementMetricSection
          title="매출"
          description="기간 내 일/월/연 단위 매출 추이와 전년 동월·요일별 분석을 함께 보여줍니다."
          rows={rows}
          metric="sales"
          valueFormat="currency"
        />
        <ManagementMetricSection
          title="진료건수"
          description="기간 내 일/월/연 단위 진료건수 추이와 전년 동월·요일별 분석을 함께 보여줍니다."
          rows={rows}
          metric="visits"
          valueFormat="integer"
          valueSuffix="건"
        />
        <ManagementMetricSection
          title="신규 환자 유입"
          description="기간 내 일/월/연 단위 신규 환자 추이와 전년 동월·요일별 분석을 함께 보여줍니다."
          rows={rows}
          metric="newPatients"
          valueFormat="integer"
          valueSuffix="명"
        />
      </div>

      {error && (
        <p className="mt-3 border border-red-900/50 bg-red-950/40 p-3 text-sm text-red-300">
          {error}
        </p>
      )}
    </main>
  );
}
