"use client";

import { useEffect, useState } from "react";
import { useHospital } from "@/components/shell/hospital-context";
import { CenteredSpinner } from "@/components/ui/loading-spinner";
import {
  fetchMetaAdsConversions,
  fetchMetaAdsDaily,
  fetchMetaAdsStatus,
  type MetaAdsConversionRow,
  type MetaAdsDailyRow,
  type MetaAdsStatus,
} from "@/lib/queries";
import MetaAdsSection from "@/components/dashboard/MetaAdsSection";

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
        // 성과·전환을 함께 받는다(같은 기간 필터를 클라이언트에서 걸기 위해).
        // 연동 상태는 빈 화면 문구를 정확히 쓰기 위한 것.
        const [d, c, s] = await Promise.all([
          fetchMetaAdsDaily(ctxHospitalId),
          fetchMetaAdsConversions(ctxHospitalId),
          fetchMetaAdsStatus(ctxHospitalId),
        ]);
        if (!cancelled) {
          setDaily(d);
          setConversions(c);
          setStatus(s);
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

  return <MetaAdsSection daily={daily} conversions={conversions} status={status} />;
}
