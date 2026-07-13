/**
 * 비교 분석 결과 목록 — admin '프롬프트 개선 > 검진 리포트' 화면용.
 * 환자·병원 라벨을 붙여 최신순으로 돌려준다.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { chartAppAuthMiddleware } from '@/lib/chart-app/auth';
import { getChartPgPool } from '@/lib/db';

export const runtime = 'nodejs';

type Row = {
  parse_run_id: string;
  status: string;
  triggered_by: string | null;
  result: unknown;
  error: string | null;
  created_at: Date;
  analyzed_at: Date | null;
  friendly_id: string | null;
  hospital_name: string | null;
};

export async function GET(request: NextRequest): Promise<Response> {
  const authErr = chartAppAuthMiddleware(request);
  if (authErr) return authErr;

  const limit = Math.min(200, Math.max(1, Number(request.nextUrl.searchParams.get('limit')) || 50));

  try {
    const pool = getChartPgPool();
    const { rows } = await pool.query<Row>(
      `SELECT d.parse_run_id, d.status, d.triggered_by, d.result, d.error, d.created_at, d.analyzed_at,
              r.friendly_id, h.name AS hospital_name
         FROM health_report.report_draft_diffs d
         LEFT JOIN chart_pdf.parse_runs r ON r.id = d.parse_run_id
         LEFT JOIN core.hospitals h ON h.id = d.hospital_id
        ORDER BY d.created_at DESC
        LIMIT $1`,
      [limit],
    );
    return NextResponse.json({
      items: rows.map((r) => ({
        runId: r.parse_run_id,
        status: r.status,
        triggeredBy: r.triggered_by,
        result: r.result,
        error: r.error,
        createdAt: r.created_at.toISOString(),
        analyzedAt: r.analyzed_at ? r.analyzed_at.toISOString() : null,
        friendlyId: r.friendly_id,
        hospitalName: r.hospital_name,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '조회 실패' }, { status: 500 });
  }
}
