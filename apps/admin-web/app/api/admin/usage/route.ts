import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { getAdminWebPgPool } from '@/lib/db';
import { formatSupabaseError } from '@/lib/format-supabase-error';

export const dynamic = 'force-dynamic';

// GET /api/admin/usage?days=30 — 병원별 LLM 사용량/비용 집계 (billing.llm_usage)
export async function GET(request: NextRequest) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const days = Math.min(365, Math.max(1, Number(request.nextUrl.searchParams.get('days')) || 30));
  const pool = getAdminWebPgPool();

  try {
    const byHospital = await pool.query<{
      hospital_id: string | null;
      hospital_name: string;
      cost_usd: number;
      input_tokens: string;
      output_tokens: string;
      calls: string;
      last_used: string | null;
    }>(
      `SELECT u.hospital_id,
              COALESCE(h.name, '(미지정/시스템)') AS hospital_name,
              SUM(u.cost_usd)::float8        AS cost_usd,
              SUM(u.input_tokens)::bigint    AS input_tokens,
              SUM(u.output_tokens)::bigint   AS output_tokens,
              COUNT(*)::bigint               AS calls,
              MAX(u.created_at)              AS last_used
         FROM billing.llm_usage u
         LEFT JOIN core.hospitals h ON h.id = u.hospital_id
        WHERE u.created_at >= now() - make_interval(days => $1::int)
        GROUP BY u.hospital_id, h.name
        ORDER BY cost_usd DESC`,
      [days],
    );

    const byFeature = await pool.query<{
      feature: string;
      provider: string;
      cost_usd: number;
      calls: string;
    }>(
      `SELECT COALESCE(feature, '(기타)') AS feature,
              provider,
              SUM(cost_usd)::float8 AS cost_usd,
              COUNT(*)::bigint      AS calls
         FROM billing.llm_usage
        WHERE created_at >= now() - make_interval(days => $1::int)
        GROUP BY feature, provider
        ORDER BY cost_usd DESC`,
      [days],
    );

    const hospitals = byHospital.rows.map((r) => ({
      hospitalId: r.hospital_id,
      hospitalName: r.hospital_name,
      costUsd: Number(r.cost_usd) || 0,
      inputTokens: Number(r.input_tokens) || 0,
      outputTokens: Number(r.output_tokens) || 0,
      calls: Number(r.calls) || 0,
      lastUsed: r.last_used,
    }));
    const features = byFeature.rows.map((r) => ({
      feature: r.feature,
      provider: r.provider,
      costUsd: Number(r.cost_usd) || 0,
      calls: Number(r.calls) || 0,
    }));
    const totalUsd = hospitals.reduce((s, h) => s + h.costUsd, 0);
    const totalCalls = hospitals.reduce((s, h) => s + h.calls, 0);

    return NextResponse.json({ days, totalUsd, totalCalls, hospitals, features });
  } catch (e) {
    // 마이그레이션 전이면 테이블이 없을 수 있음 — 빈 데이터 + 안내.
    if ((e as { code?: string }).code === '42P01') {
      return NextResponse.json({
        days,
        totalUsd: 0,
        totalCalls: 0,
        hospitals: [],
        features: [],
        note: 'billing.llm_usage 테이블이 아직 없습니다. 마이그레이션을 먼저 적용하세요.',
      });
    }
    return NextResponse.json({ error: formatSupabaseError(e) }, { status: 500 });
  }
}
