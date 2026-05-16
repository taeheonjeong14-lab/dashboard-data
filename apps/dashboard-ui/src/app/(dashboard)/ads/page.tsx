"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { fetchSearchAdDailyMetrics, type SearchAdDailyRow } from "@/lib/queries";
import AdsMetricSection from "@/components/ads/AdsMetricSection";
import AdsCampaignCtrSection from "@/components/ads/AdsCampaignCtrSection";

export default function AdsPerformancePage() {
  const { scope } = useAuth();
  const hospitalId = scope.assignedHospitalId;

  const [rows, setRows] = useState<SearchAdDailyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hospitalId) {
      setError("hospital_id 배정이 없어 광고 데이터를 불러올 수 없습니다.");
      setLoading(false);
      return;
    }

    let active = true;
    fetchSearchAdDailyMetrics(hospitalId)
      .then((data) => {
        if (!active) return;
        setRows(data);
        setError(null);
      })
      .catch((e) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : "데이터를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [hospitalId]);

  if (loading) {
    return (
      <main className="flex min-h-[40vh] items-center justify-center px-4">
        <p className="text-sm text-zinc-400">데이터 준비 중…</p>
      </main>
    );
  }

  return (
    <main className="w-full max-w-none px-4 py-4 sm:px-5 sm:py-5 lg:px-6">
      <header className="mb-4 border-b border-zinc-800 pb-3">
        <h1 className="text-2xl font-bold text-zinc-50">네이버 광고 실적</h1>
        <p className="mt-1 text-sm text-zinc-400">
          캠페인별 노출수·클릭수·클릭률·비용을 일별로 확인합니다.
        </p>
      </header>

      {error && (
        <p className="mb-4 border border-red-900/50 bg-red-950/40 p-3 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="flex flex-col divide-y divide-zinc-800">
        <AdsMetricSection
          title="노출수"
          description="모든 캠페인을 합산한 일별 총 노출수입니다."
          rows={rows}
          metric="impressions"
        />
        <AdsMetricSection
          title="클릭수"
          description="모든 캠페인을 합산한 일별 총 클릭수입니다."
          rows={rows}
          metric="clicks"
        />
        <AdsMetricSection
          title="클릭률 (CTR)"
          description="모든 캠페인을 합산한 일별 클릭률입니다. (클릭수 ÷ 노출수 × 100)"
          rows={rows}
          metric="ctr"
        />
        <AdsMetricSection
          title="비용"
          description="모든 캠페인을 합산한 일별 총 광고 비용입니다."
          rows={rows}
          metric="cost"
        />
        <AdsCampaignCtrSection rows={rows} />
      </div>
    </main>
  );
}
