"use client";

import { useEffect, useState } from "react";
import { useHospital } from "@/components/hospital-dashboard/context";
import { CenteredSpinner } from "@/components/hospital-dashboard/spinner";
import type {
  MetaAdsConversionRow,
  MetaAdsDailyRow,
  MetaAdsStatus,
} from "@/lib/hospital-dashboard/types";
import { fetchMetaAds } from "@/lib/hospital-dashboard/queries";
import MetaAdsSection from "@/components/hospital-dashboard/MetaAdsSection";

type LoadState = "loading" | "error" | "done";

export default function MetaAdsTab() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [daily, setDaily] = useState<MetaAdsDailyRow[]>([]);
  const [conversions, setConversions] = useState<MetaAdsConversionRow[]>([]);
  const [status, setStatus] = useState<MetaAdsStatus | null>(null);

  const { hospitalId: ctxHospitalId } = useHospital();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        if (!ctxHospitalId) {
          if (!cancelled) setLoadState("done");
          return;
        }
        const { rows, conversions: conv, status: st } = await fetchMetaAds(ctxHospitalId);
        if (!cancelled) {
          setDaily(rows);
          setConversions(conv);
          setStatus(st);
          setLoadState("done");
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "데이터를 불러오는 중 오류가 발생했습니다.",
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

  if (loadState === "loading") return <CenteredSpinner />;
  if (loadState === "error") {
    return (
      <p className="border border-[var(--border)] bg-[var(--bg)] p-4 text-sm text-[var(--danger,#dc2626)]">
        {error}
      </p>
    );
  }

  // admin 에선 왜 비었는지(계정 미지정·수집 OFF·미수집) 바로 보이도록 진단 줄을 켠다.
  return (
    <MetaAdsSection
      daily={daily}
      conversions={conversions}
      status={status}
      showDiagnostics
    />
  );
}
