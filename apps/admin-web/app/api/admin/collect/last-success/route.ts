import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { getAdminWebPgPool } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

// 수집 스텝별 마지막 성공 날짜 (hospital_id → { blog_metrics, smartplace, keyword_rank, searchad })
export async function GET() {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const pool = getAdminWebPgPool();
  const { rows } = await pool.query<{
    hospital_id: string;
    blog_metrics: string | null;
    smartplace: string | null;
    keyword_rank: string | null;
    searchad: string | null;
  }>(`
    SELECT
      hospital_id,
      MAX(CASE WHEN src = 'blog_metrics'  THEN metric_date END) AS blog_metrics,
      MAX(CASE WHEN src = 'smartplace'    THEN metric_date END) AS smartplace,
      MAX(CASE WHEN src = 'keyword_rank'  THEN metric_date END) AS keyword_rank,
      MAX(CASE WHEN src = 'searchad'      THEN metric_date END) AS searchad
    FROM (
      SELECT hospital_id, metric_date, 'blog_metrics' AS src
        FROM analytics.analytics_blog_daily_metrics
        WHERE hospital_id IS NOT NULL
      UNION ALL
      SELECT hospital_id, metric_date, 'smartplace' AS src
        FROM analytics.analytics_smartplace_daily_metrics
        WHERE hospital_id IS NOT NULL
      UNION ALL
      SELECT hospital_id, metric_date, 'keyword_rank' AS src
        FROM analytics.analytics_blog_keyword_ranks
        WHERE hospital_id IS NOT NULL
      UNION ALL
      SELECT hospital_id, metric_date, 'keyword_rank' AS src
        FROM analytics.analytics_place_keyword_ranks
        WHERE hospital_id IS NOT NULL
      UNION ALL
      SELECT hospital_id, metric_date, 'searchad' AS src
        FROM analytics.analytics_searchad_daily_metrics
        WHERE hospital_id IS NOT NULL
    ) t
    GROUP BY hospital_id
  `);

  // { hospitalId: { blog_metrics: "2026-05-19", ... } } 형태로 변환
  const result: Record<string, Record<string, string>> = {};
  for (const row of rows) {
    result[row.hospital_id] = {
      ...(row.blog_metrics  ? { blog_metrics:  row.blog_metrics.slice(0, 10)  } : {}),
      ...(row.smartplace    ? { smartplace:    row.smartplace.slice(0, 10)    } : {}),
      ...(row.keyword_rank  ? { keyword_rank:  row.keyword_rank.slice(0, 10)  } : {}),
      ...(row.searchad      ? { searchad:      row.searchad.slice(0, 10)      } : {}),
    };
  }

  return NextResponse.json(result);
}
