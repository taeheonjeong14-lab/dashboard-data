'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { adminStatsGetJson } from '@/lib/admin-stats/client-api';
import type { SearchAdDailyRow } from '@/lib/admin-stats/queries-server';

const AdsMetricSection = dynamic(
  () => import('@/components/admin-stats/ads/AdsMetricSection'),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-[160px] items-center justify-center border-b border-slate-200 bg-white py-8 text-sm text-slate-500">
        차트를 불러오는 중…
      </div>
    ),
  },
);

const AdsCampaignCtrSection = dynamic(
  () => import('@/components/admin-stats/ads/AdsCampaignCtrSection'),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-[160px] items-center justify-center border-b border-slate-200 bg-white py-8 text-sm text-slate-500">
        차트를 불러오는 중…
      </div>
    ),
  },
);

export default function AdminPerformanceAdsPage() {
  const params = useParams();
  const hospitalId = typeof params.hospitalId === 'string' ? params.hospitalId : '';

  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<SearchAdDailyRow[]>([]);

  useEffect(() => {
    if (!hospitalId) return;
    let active = true;
    setReady(false);
    setLoading(true);
    setRows([]);
    setError(null);

    adminStatsGetJson<{ rows: SearchAdDailyRow[] }>('ads-metrics', hospitalId)
      .then((data) => {
        if (!active) return;
        setRows(data.rows ?? []);
        setError(null);
      })
      .catch((e) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : '데이터를 불러오지 못했습니다.');
        setRows([]);
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
        setReady(true);
      });

    return () => {
      active = false;
    };
  }, [hospitalId]);

  if (!ready) {
    return (
      <main className="flex min-h-[40vh] items-center justify-center px-4">
        <p className="text-sm text-slate-600">데이터 준비 중…</p>
      </main>
    );
  }

  return (
    <main className="w-full max-w-none px-4 pb-4 pt-0 sm:px-5 sm:pb-5 sm:pt-0 lg:px-6">
      {loading && <p className="mb-2 text-sm text-slate-500">불러오는 중…</p>}

      {error && (
        <p className="mb-3 border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          오류: {error}
        </p>
      )}

      {!error && rows.length === 0 && (
        <div className="mb-3 border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <p className="font-medium">조회된 광고 데이터가 없습니다.</p>
          <p className="mt-0.5 text-xs text-amber-700">
            analytics_searchad_daily_metrics 테이블에 이 병원의 데이터가 없거나,
            네이버 광고 계정이 연동되지 않았을 수 있습니다.
          </p>
        </div>
      )}

      <div className="flex flex-col divide-y divide-slate-200">
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
