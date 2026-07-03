import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { getAdminWebPgPool } from '@/lib/db';
import { formatSupabaseError } from '@/lib/format-supabase-error';

export const dynamic = 'force-dynamic';

// GET /api/admin/feature-usage?days=30 (days=all → 전체 기간)
// 병원별 기능 산출물 건수: 진료케이스 / 건강검진 / 초진접수 / 사전문진.
//  - 진료케이스·건강검진: health_report.generated_run_content → chart_pdf.parse_runs.hospital_id (uuid)
//  - 초진접수: intake.submissions.hospital_id (text)
//  - 사전문진: robovet.survey_sessions."hospitalId" (text)
// hospital_id 타입이 스키마마다 다르므로 core.hospitals.id(text)에 text 로 맞춰 조인.
export async function GET(request: NextRequest) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const daysParam = (request.nextUrl.searchParams.get('days') ?? '30').trim();
  const all = daysParam === 'all' || daysParam === '0';
  const days = all ? 0 : Math.min(3650, Math.max(1, Number(daysParam) || 30));
  const pool = getAdminWebPgPool();

  try {
    const { rows } = await pool.query<{
      hospital_id: string;
      hospital_name: string;
      address: string | null;
      case_blog: string | null;
      health_report: string | null;
      intake: string | null;
      pre_consult: string | null;
      tokens_used: string | number | null;
      last_used: string | null;
    }>(
      `WITH cb AS (
         SELECT pr.hospital_id::text AS hid,
                COUNT(DISTINCT grc.parse_run_id)::bigint AS n,
                MAX(grc.created_at) AS last_used
           FROM health_report.generated_run_content grc
           JOIN chart_pdf.parse_runs pr ON pr.id = grc.parse_run_id
          WHERE grc.content_type IN ('blog_causal','blog_detail','blog_outline','blog_post')
            AND ($2::boolean OR grc.created_at >= now() - make_interval(days => $1::int))
          GROUP BY pr.hospital_id::text
       ),
       hr AS (
         SELECT pr.hospital_id::text AS hid,
                COUNT(DISTINCT grc.parse_run_id)::bigint AS n,
                MAX(grc.created_at) AS last_used
           FROM health_report.generated_run_content grc
           JOIN chart_pdf.parse_runs pr ON pr.id = grc.parse_run_id
          WHERE grc.content_type = 'health_checkup'
            AND ($2::boolean OR grc.created_at >= now() - make_interval(days => $1::int))
          GROUP BY pr.hospital_id::text
       ),
       ik AS (
         SELECT hospital_id AS hid, COUNT(*)::bigint AS n, MAX(created_at) AS last_used
           FROM intake.submissions
          WHERE ($2::boolean OR created_at >= now() - make_interval(days => $1::int))
          GROUP BY hospital_id
       ),
       pc AS (
         SELECT "hospitalId" AS hid, COUNT(*)::bigint AS n, MAX("createdAt") AS last_used
           FROM robovet.survey_sessions
          WHERE "hospitalId" IS NOT NULL
            AND ($2::boolean OR "createdAt" >= now() - make_interval(days => $1::int))
          GROUP BY "hospitalId"
       ),
       tk AS (
         -- 실제 차감 토큰(사용) — 사용(charge, 음수)+환불(adjust, 양수) net 을 사용량(양수)으로.
         SELECT hospital_id::text AS hid, (-SUM(tokens))::float8 AS used
           FROM billing.token_ledger
          WHERE kind IN ('charge','adjust')
            AND ($2::boolean OR created_at >= now() - make_interval(days => $1::int))
          GROUP BY hospital_id::text
       )
       SELECT h.id AS hospital_id,
              COALESCE(h.name, '(이름없음)') AS hospital_name,
              h.address,
              COALESCE(cb.n, 0) AS case_blog,
              COALESCE(hr.n, 0) AS health_report,
              COALESCE(ik.n, 0) AS intake,
              COALESCE(pc.n, 0) AS pre_consult,
              COALESCE(tk.used, 0) AS tokens_used,
              GREATEST(cb.last_used, hr.last_used, ik.last_used, pc.last_used) AS last_used
         FROM core.hospitals h
         LEFT JOIN cb ON cb.hid = h.id
         LEFT JOIN hr ON hr.hid = h.id
         LEFT JOIN ik ON ik.hid = h.id
         LEFT JOIN pc ON pc.hid = h.id
         LEFT JOIN tk ON tk.hid = h.id
        ORDER BY COALESCE(tk.used, 0) DESC,
                 (COALESCE(cb.n,0)+COALESCE(hr.n,0)+COALESCE(ik.n,0)+COALESCE(pc.n,0)) DESC,
                 h.name ASC`,
      [days, all],
    );

    const hospitals = rows.map((r) => {
      const caseBlog = Number(r.case_blog) || 0;
      const healthReport = Number(r.health_report) || 0;
      const intake = Number(r.intake) || 0;
      const preConsult = Number(r.pre_consult) || 0;
      const tokensUsed = Math.max(0, Math.round(Number(r.tokens_used) || 0));
      return {
        hospitalId: r.hospital_id,
        hospitalName: r.hospital_name,
        address: r.address ?? null,
        caseBlog,
        healthReport,
        intake,
        preConsult,
        tokensUsed,
        // 사용 이력 판정용(기능 산출물 건수 합). 화면에는 표시하지 않음.
        total: caseBlog + healthReport + intake + preConsult,
        lastUsed: r.last_used,
      };
    });

    const totals = hospitals.reduce(
      (acc, h) => {
        acc.caseBlog += h.caseBlog;
        acc.healthReport += h.healthReport;
        acc.intake += h.intake;
        acc.preConsult += h.preConsult;
        acc.tokensUsed += h.tokensUsed;
        acc.total += h.total;
        return acc;
      },
      { caseBlog: 0, healthReport: 0, intake: 0, preConsult: 0, tokensUsed: 0, total: 0 },
    );

    return NextResponse.json({ days: all ? 'all' : days, totals, hospitals });
  } catch (e) {
    // 스키마/테이블 미존재(마이그레이션 전) → 빈 결과로 안전 반환
    if ((e as { code?: string }).code === '42P01' || (e as { code?: string }).code === '42703') {
      return NextResponse.json({
        days: all ? 'all' : days,
        totals: { caseBlog: 0, healthReport: 0, intake: 0, preConsult: 0, tokensUsed: 0, total: 0 },
        hospitals: [],
        note: '일부 기능 테이블이 아직 없습니다.',
      });
    }
    return NextResponse.json({ error: formatSupabaseError(e) }, { status: 500 });
  }
}
