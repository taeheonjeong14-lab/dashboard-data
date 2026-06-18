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
      address: string | null;
      token_balance: string | number | null;
      cost_usd: number | null;
      input_tokens: string | null;
      output_tokens: string | null;
      calls: string | null;
      last_used: string | null;
    }>(
      `SELECT h.id AS hospital_id,
              COALESCE(h.name, '(이름없음)') AS hospital_name,
              h.address,
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
      address: r.address ?? null,
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

    // 선택 병원: 건(run)별 사용 내역 + 건별 세부 항목(기능별)
    // 토큰은 화면 표시도 '실제 차감값'으로 — billing.token_ledger 의 정수 토큰을 그대로 사용(operation 단위 ceil + ×20 + 환불 반영).
    type UsageItem = { feature: string; provider: string; costUsd: number; calls: number; tokens: number };
    type UsageRun = {
      runId: string | null; friendlyId: string | null; patientName: string | null; ownerName: string | null;
      lastUsed: string | null; costUsd: number; calls: number; tokens: number; refunded: boolean; items: UsageItem[];
    };
    const hospitalIdParam = request.nextUrl.searchParams.get('hospitalId');
    let runs: UsageRun[] = [];
    if (hospitalIdParam && /^[0-9a-fA-F-]{36}$/.test(hospitalIdParam)) {
      // 1) usage 집계 — run+feature 별 원가/호출수/프로바이더 (세부 항목 표시용)
      const rowsRes = await pool.query<{
        run_id: string | null; feature: string; providers: string[] | null; cost_usd: number; calls: string; last_used: string;
      }>(
        `SELECT u.run_id, COALESCE(u.feature, '(기타)') AS feature,
                array_agg(DISTINCT u.provider) AS providers,
                SUM(u.cost_usd)::float8 AS cost_usd, COUNT(*)::bigint AS calls, MAX(u.created_at) AS last_used
           FROM billing.llm_usage u
          WHERE u.hospital_id = $1::uuid AND u.created_at >= now() - make_interval(days => $2::int)
          GROUP BY u.run_id, u.feature`,
        [hospitalIdParam, days],
      );
      // 2) 실제 차감 토큰 — token_ledger 를 run+feature 로 묶어 net(charge 음수 + 환불 양수) 합산. 표시는 차감액(양수)로 부호 반전.
      const ledgerRes = await pool.query<{ run_id: string | null; feature: string; tokens: number }>(
        `SELECT u.run_id, COALESCE(l.feature, '(기타)') AS feature, SUM(l.tokens)::float8 AS tokens
           FROM billing.token_ledger l
           JOIN (SELECT DISTINCT operation_id, run_id
                   FROM billing.llm_usage
                  WHERE hospital_id = $1::uuid AND created_at >= now() - make_interval(days => $2::int) AND operation_id IS NOT NULL
                ) u ON u.operation_id = l.operation_id
          WHERE l.hospital_id = $1::uuid
          GROUP BY u.run_id, l.feature`,
        [hospitalIdParam, days],
      );
      const deductedByRunFeature = new Map<string, Map<string, number>>();
      for (const r of ledgerRes.rows) {
        const rk = r.run_id ?? 'none';
        const m = deductedByRunFeature.get(rk) ?? new Map<string, number>();
        m.set(r.feature, (m.get(r.feature) ?? 0) - (Number(r.tokens) || 0)); // charge 음수 → 차감액 양수
        deductedByRunFeature.set(rk, m);
      }
      // run 메타(친화번호·환자/보호자명) — run_id 당 1행
      const runIds = [...new Set(rowsRes.rows.map((r) => r.run_id).filter((x): x is string => !!x))];
      const metaMap = new Map<string, { friendlyId: string | null; patientName: string | null; ownerName: string | null }>();
      if (runIds.length) {
        const metaRes = await pool.query<{ run_id: string; friendly_id: string | null; patient_name: string | null; owner_name: string | null }>(
          `SELECT DISTINCT ON (pr.id) pr.id::text AS run_id, pr.friendly_id, bi.patient_name, bi.owner_name
             FROM chart_pdf.parse_runs pr
             LEFT JOIN chart_pdf.result_basic_info bi ON bi.parse_run_id = pr.id
            WHERE pr.id = ANY($1::uuid[])
            ORDER BY pr.id`,
          [runIds],
        );
        for (const m of metaRes.rows) metaMap.set(m.run_id, { friendlyId: m.friendly_id, patientName: m.patient_name, ownerName: m.owner_name });
      }
      // 바른플랜 환불된 run(진료케이스 차감 후 즉시 환불) — token_ledger note 로 판별
      const refundedRes = await pool.query<{ run_id: string }>(
        `SELECT DISTINCT u.run_id
           FROM billing.token_ledger l
           JOIN billing.llm_usage u ON u.operation_id = l.operation_id
          WHERE u.hospital_id = $1::uuid AND u.run_id IS NOT NULL
            AND l.kind = 'adjust' AND l.note = 'barun_plan_refund'`,
        [hospitalIdParam],
      );
      const refundedRuns = new Set(refundedRes.rows.map((r) => r.run_id));

      const byRun = new Map<string, UsageRun>();
      for (const r of rowsRes.rows) {
        const key = r.run_id ?? 'none';
        let g = byRun.get(key);
        if (!g) {
          const meta = r.run_id ? metaMap.get(r.run_id) : null;
          g = {
            runId: r.run_id, friendlyId: meta?.friendlyId ?? null, patientName: meta?.patientName ?? null,
            ownerName: meta?.ownerName ?? null, lastUsed: r.last_used, costUsd: 0, calls: 0, tokens: 0,
            refunded: r.run_id ? refundedRuns.has(r.run_id) : false, items: [],
          };
          byRun.set(key, g);
        }
        const tokens = deductedByRunFeature.get(key)?.get(r.feature) ?? 0;
        g.items.push({
          feature: r.feature,
          provider: (r.providers ?? []).filter(Boolean).join(', '),
          costUsd: Number(r.cost_usd) || 0,
          calls: Number(r.calls) || 0,
          tokens,
        });
        g.costUsd += Number(r.cost_usd) || 0;
        g.calls += Number(r.calls) || 0;
        if ((r.last_used ?? '') > (g.lastUsed ?? '')) g.lastUsed = r.last_used;
      }
      // run 합계 토큰 = ledger net 합(이 run 의 모든 feature). usage 에 없던 ledger feature 도 항목으로 보강.
      for (const [rk, fm] of deductedByRunFeature) {
        const g = byRun.get(rk);
        if (!g) continue;
        let total = 0;
        for (const v of fm.values()) total += v;
        g.tokens = total;
        const have = new Set(g.items.map((i) => i.feature));
        for (const [f, v] of fm) {
          if (!have.has(f) && v !== 0) g.items.push({ feature: f, provider: '', costUsd: 0, calls: 0, tokens: v });
        }
      }
      runs = [...byRun.values()]
        .map((g) => ({ ...g, items: g.items.sort((a, b) => b.tokens - a.tokens || b.costUsd - a.costUsd) }))
        .sort((a, b) => ((a.lastUsed ?? '') < (b.lastUsed ?? '') ? 1 : -1));
    }

    return NextResponse.json({ days, totalUsd, totalCalls, systemUsd, hospitals, features, runs });
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
