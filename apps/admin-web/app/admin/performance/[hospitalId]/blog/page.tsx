'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import BlogMetricSection from '@/components/admin-stats/blog/BlogMetricSection';
import BlogTrendTables from '@/components/admin-stats/blog/BlogTrendTables';
import { adminStatsGetJson } from '@/lib/admin-stats/client-api';
import type { BlogPeriodDayRow, BlogRankDailyRow } from '@/lib/admin-stats/queries-server';

type MetricKey = 'views' | 'uniqueVisitors';

export default function AdminPerformanceBlogPage() {
  const params = useParams();
  const hospitalId = typeof params.hospitalId === 'string' ? params.hospitalId : '';

  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<BlogPeriodDayRow[]>([]);
  const [daily, setDaily] = useState<BlogRankDailyRow[]>([]);
  const [metric, setMetric] = useState<MetricKey>('views');

  useEffect(() => {
    if (!hospitalId) return;
    let active = true;
    setReady(false);
    setLoading(true);
    setError(null);
    setPeriod([]);
    setDaily([]);
    Promise.all([
      adminStatsGetJson<{ rows: BlogPeriodDayRow[] }>('blog-period', hospitalId),
      adminStatsGetJson<{ rows: BlogRankDailyRow[] }>('blog-ranks-daily', hospitalId),
    ])
      .then(([p, d]) => {
        if (!active) return;
        setPeriod(p.rows ?? []);
        setDaily(d.rows ?? []);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : '데이터를 불러오지 못했습니다.');
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

  const metricMeta: Record<MetricKey, { title: string; suffix: string }> = {
    views: { title: '블로그 조회수', suffix: '회' },
    uniqueVisitors: { title: '블로그 순방문자수', suffix: '명' },
  };

  return (
    <main className="min-h-screen w-full max-w-none px-4 pb-4 pt-0 sm:px-5 sm:pb-5 sm:pt-0 lg:px-6">
      {loading && <p className="text-sm text-slate-500">불러오는 중…</p>}

      {/* 상단: 풀폭 그래프 1개 + 조회수/순방문자 토글 */}
      <div className="mb-2 flex overflow-hidden rounded border border-slate-300 text-xs" style={{ width: 'fit-content' }}>
        {(['views', 'uniqueVisitors'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMetric(m)}
            className={`px-3 py-1.5 ${metric === m ? 'bg-slate-800 text-white' : 'bg-white text-slate-600'}`}
          >
            {metricMeta[m].title}
          </button>
        ))}
      </div>
      <BlogMetricSection
        title={metricMeta[metric].title}
        rows={period}
        metric={metric}
        valueSuffix={metricMeta[metric].suffix}
      />

      {/* 하단: 추이 표 3개 */}
      <div className="mt-6 border-t border-slate-200 pt-5">
        <BlogTrendTables period={period} daily={daily} />
      </div>

      {error && (
        <p className="mt-3 border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>
      )}
    </main>
  );
}
