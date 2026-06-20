import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { getAdminWebPgPool } from '@/lib/db';
import { formatSupabaseError } from '@/lib/format-supabase-error';
import { notifyHospitalUsers } from '@/lib/notify';

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

    // 선택 병원: hospital-ui 사용량 탭과 '동일한' 사용·충전 내역(ledger: 사용/지급/조정)
    //  + 각 사용(charge) 건을 펼쳐 볼 항목(runItems). 토큰은 전부 billing.token_ledger 의 실제 차감 정수값.
    type LedgerRow = {
      createdAt: string; kind: string; feature: string | null; tokens: number; balanceAfter: number | null;
      runId: string | null; note: string | null; ownerName: string | null; patientName: string | null;
    };
    type RunItem = { feature: string; provider: string; costUsd: number; calls: number; tokens: number };
    const hospitalIdParam = request.nextUrl.searchParams.get('hospitalId');
    let ledger: LedgerRow[] = [];
    const runItems: Record<string, RunItem[]> = {};
    if (hospitalIdParam && /^[0-9a-fA-F-]{36}$/.test(hospitalIdParam)) {
      // 사용·충전 내역 — charge/grant/adjust 전부. run_id(operation→llm_usage) + 보호자/환자명. (hospital-ui 와 동일)
      const ledgerRes = await pool.query<{
        created_at: string; kind: string; feature: string | null; tokens: number; balance_after: number | null;
        run_id: string | null; note: string | null; owner_name: string | null; patient_name: string | null;
      }>(
        `SELECT base.created_at, base.kind, base.feature, base.tokens, base.balance_after, base.run_id, base.note,
                bi.owner_name, bi.patient_name
           FROM (
             SELECT tl.created_at, tl.kind, tl.feature, tl.tokens, tl.balance_after, tl.note,
                    (SELECT u.run_id FROM billing.llm_usage u
                      WHERE u.operation_id = tl.operation_id AND u.run_id IS NOT NULL LIMIT 1) AS run_id
               FROM billing.token_ledger tl
              WHERE tl.hospital_id = $1::uuid
              ORDER BY tl.created_at DESC
              LIMIT 200
           ) base
           LEFT JOIN chart_pdf.result_basic_info bi ON bi.parse_run_id = base.run_id`,
        [hospitalIdParam],
      );
      ledger = ledgerRes.rows.map((r) => ({
        createdAt: r.created_at, kind: r.kind, feature: r.feature, tokens: Number(r.tokens) || 0,
        balanceAfter: r.balance_after == null ? null : Number(r.balance_after),
        runId: r.run_id, note: r.note, ownerName: r.owner_name, patientName: r.patient_name,
      }));

      // 3) 펼침용 항목 — 내역의 사용(charge) 건 run_id 들에 대해 기능별 원가/프로바이더/호출수 + 실제 차감 토큰.
      const runIds = [...new Set(ledger.filter((l) => l.kind === 'charge' && l.runId).map((l) => l.runId as string))];
      if (runIds.length) {
        const [usageItemsRes, ledgerItemsRes] = await Promise.all([
          pool.query<{ run_id: string; feature: string; providers: string[] | null; cost_usd: number; calls: string }>(
            `SELECT u.run_id, COALESCE(u.feature, '(기타)') AS feature,
                    array_agg(DISTINCT u.provider) AS providers,
                    SUM(u.cost_usd)::float8 AS cost_usd, COUNT(*)::bigint AS calls
               FROM billing.llm_usage u
              WHERE u.hospital_id = $1::uuid AND u.run_id = ANY($2::uuid[])
              GROUP BY u.run_id, u.feature`,
            [hospitalIdParam, runIds],
          ),
          pool.query<{ run_id: string; feature: string; tokens: number }>(
            // 순수 차감(charge)만, 부호 유지(음수). 환불(adjust)은 펼침에서 별도 라인으로 표시하므로 여기서 제외.
            `SELECT u.run_id, COALESCE(l.feature, '(기타)') AS feature, SUM(l.tokens)::float8 AS tokens
               FROM billing.token_ledger l
               JOIN (SELECT DISTINCT operation_id, run_id FROM billing.llm_usage
                      WHERE hospital_id = $1::uuid AND run_id = ANY($2::uuid[]) AND operation_id IS NOT NULL) u
                 ON u.operation_id = l.operation_id
              WHERE l.hospital_id = $1::uuid AND l.kind = 'charge'
              GROUP BY u.run_id, l.feature`,
            [hospitalIdParam, runIds],
          ),
        ]);
        const tokByRunFeature = new Map<string, number>();
        for (const r of ledgerItemsRes.rows) tokByRunFeature.set(`${r.run_id}|${r.feature}`, Number(r.tokens) || 0);
        const byRun = new Map<string, RunItem[]>();
        for (const r of usageItemsRes.rows) {
          const arr = byRun.get(r.run_id) ?? [];
          arr.push({
            feature: r.feature,
            provider: (r.providers ?? []).filter(Boolean).join(', '),
            costUsd: Number(r.cost_usd) || 0,
            calls: Number(r.calls) || 0,
            tokens: tokByRunFeature.get(`${r.run_id}|${r.feature}`) ?? 0,
          });
          byRun.set(r.run_id, arr);
        }
        for (const [rid, arr] of byRun) runItems[rid] = arr.sort((a, b) => b.tokens - a.tokens || b.costUsd - a.costUsd);
      }
    }

    return NextResponse.json({ days, totalUsd, totalCalls, systemUsd, hospitals, features, ledger, runItems });
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
    // 충전(양수 지급) 시 마스터에게 알림. (차감/음수는 알림 안 함)
    if (tokens > 0) {
      await notifyHospitalUsers(hospitalId, {
        type: 'token_granted',
        title: '토큰 충전 완료',
        body: `토큰 ${tokens.toLocaleString()}개가 충전되었습니다.`,
      }, { role: 'master' });
    }
    return NextResponse.json({ ok: true, balanceAfter: Number(rows[0]?.token_grant) });
  } catch (e) {
    return NextResponse.json({ error: formatSupabaseError(e) }, { status: 500 });
  }
}
