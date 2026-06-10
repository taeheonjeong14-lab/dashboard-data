import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { getAdminWebPgPool } from '@/lib/db';
import { formatSupabaseError } from '@/lib/format-supabase-error';

export const dynamic = 'force-dynamic';

// GET /api/admin/usage?days=30 — 병원별 LLM 사용량/비용 + 토큰 잔액 (billing.llm_usage + core.hospitals)
export async function GET(request: NextRequest) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const days = Math.min(365, Math.max(1, Number(request.nextUrl.searchParams.get('days')) || 30));
  const pool = getAdminWebPgPool();

  try {
    // 모든 병원 + 기간 내 사용량 합산 + 토큰 잔액 (사용량 없는 병원도 잔액 관리 위해 포함)
    const byHospital = await pool.query<{
      hospital_id: string;
      hospital_name: string;
      token_balance: string | number | null;
      cost_usd: number | null;
      input_tokens: string | null;
      output_tokens: string | null;
      calls: string | null;
      last_used: string | null;
    }>(
      `SELECT h.id AS hospital_id,
              COALESCE(h.name, '(이름없음)') AS hospital_name,
              h.token_balance,
              u.cost_usd, u.input_tokens, u.output_tokens, u.calls, u.last_used
         FROM core.hospitals h
         LEFT JOIN (
           SELECT hospital_id,
                  SUM(cost_usd)::float8 AS cost_usd,
                  SUM(input_tokens)::bigint AS input_tokens,
                  SUM(output_tokens)::bigint AS output_tokens,
                  COUNT(*)::bigint AS calls,
                  MAX(created_at) AS last_used
             FROM billing.llm_usage
            WHERE created_at >= now() - make_interval(days => $1::int)
            GROUP BY hospital_id
         ) u ON u.hospital_id = h.id::uuid
        ORDER BY COALESCE(u.cost_usd, 0) DESC, h.name ASC`,
      [days],
    );

    // 미귀속(시스템) 사용량 — hospital_id IS NULL
    const sys = await pool.query<{ cost_usd: number | null; calls: string | null }>(
      `SELECT SUM(cost_usd)::float8 AS cost_usd, COUNT(*)::bigint AS calls
         FROM billing.llm_usage
        WHERE created_at >= now() - make_interval(days => $1::int) AND hospital_id IS NULL`,
      [days],
    );

    const byFeature = await pool.query<{ feature: string; provider: string; cost_usd: number; calls: string }>(
      `SELECT COALESCE(feature, '(기타)') AS feature, provider,
              SUM(cost_usd)::float8 AS cost_usd, COUNT(*)::bigint AS calls
         FROM billing.llm_usage
        WHERE created_at >= now() - make_interval(days => $1::int)
        GROUP BY feature, provider
        ORDER BY cost_usd DESC`,
      [days],
    );

    const hospitals = byHospital.rows.map((r) => ({
      hospitalId: r.hospital_id,
      hospitalName: r.hospital_name,
      tokenBalance: r.token_balance == null ? 0 : Number(r.token_balance),
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
    const totalUsd = hospitals.reduce((s, h) => s + h.costUsd, 0) + (Number(sys.rows[0]?.cost_usd) || 0);
    const totalCalls = hospitals.reduce((s, h) => s + h.calls, 0) + (Number(sys.rows[0]?.calls) || 0);
    const systemUsd = Number(sys.rows[0]?.cost_usd) || 0;

    // 선택 병원: 날짜×기능 일별 사용량(그래프용)
    const hospitalIdParam = request.nextUrl.searchParams.get('hospitalId');
    let daily: { date: string; feature: string; costUsd: number }[] = [];
    let featureKeys: string[] = [];
    if (hospitalIdParam && /^[0-9a-fA-F-]{36}$/.test(hospitalIdParam)) {
      const d = await pool.query<{ date: string; feature: string; cost_usd: number }>(
        `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS date,
                COALESCE(feature, '(기타)') AS feature,
                SUM(cost_usd)::float8 AS cost_usd
           FROM billing.llm_usage
          WHERE hospital_id = $1::uuid AND created_at >= now() - make_interval(days => $2::int)
          GROUP BY 1, 2
          ORDER BY 1`,
        [hospitalIdParam, days],
      );
      daily = d.rows.map((r) => ({ date: r.date, feature: r.feature, costUsd: Number(r.cost_usd) || 0 }));
      featureKeys = [...new Set(daily.map((x) => x.feature))];
    }

    return NextResponse.json({ days, totalUsd, totalCalls, systemUsd, hospitals, features, daily, featureKeys });
  } catch (e) {
    if ((e as { code?: string }).code === '42P01' || (e as { code?: string }).code === '42703') {
      return NextResponse.json({
        days,
        totalUsd: 0,
        totalCalls: 0,
        systemUsd: 0,
        hospitals: [],
        features: [],
        note: 'billing.llm_usage / token_balance 가 아직 없습니다. 마이그레이션을 먼저 적용하세요.',
      });
    }
    return NextResponse.json({ error: formatSupabaseError(e) }, { status: 500 });
  }
}

// POST /api/admin/usage/grant 대신 같은 라우트 POST 로 토큰 지급/조정.
export async function POST(request: NextRequest) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  let body: { hospitalId?: string; tokens?: number; note?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }
  const hospitalId = typeof body.hospitalId === 'string' ? body.hospitalId.trim() : '';
  const tokens = Math.trunc(Number(body.tokens));
  if (!/^[0-9a-fA-F-]{36}$/.test(hospitalId)) {
    return NextResponse.json({ error: 'hospitalId 형식 오류' }, { status: 400 });
  }
  if (!Number.isFinite(tokens) || tokens === 0) {
    return NextResponse.json({ error: '지급/차감할 토큰 수(0이 아닌 정수)가 필요합니다.' }, { status: 400 });
  }
  try {
    const { rows } = await getAdminWebPgPool().query<{ token_grant: number }>(
      `SELECT billing.token_grant($1, $2::int, $3, 'grant') AS token_grant`,
      [hospitalId, tokens, typeof body.note === 'string' ? body.note : null],
    );
    return NextResponse.json({ ok: true, balanceAfter: Number(rows[0]?.token_grant) });
  } catch (e) {
    return NextResponse.json({ error: formatSupabaseError(e) }, { status: 500 });
  }
}
