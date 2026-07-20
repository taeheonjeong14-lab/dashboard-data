/**
 * 블로그 초안-확정본 비교 분석 결과 목록 — admin '프롬프트 개선 > 블로그 컨텐츠' 화면용.
 * 환자·병원 라벨을 붙여 최신순으로 돌려준다.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { chartAppAuthMiddleware } from '@/lib/chart-app/auth';
import { getChartPgPool } from '@/lib/db';

export const runtime = 'nodejs';

type Row = {
  parse_run_id: string;
  status: string;
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
      // parse_run_id·hospital_id 와 상대 테이블 id 의 타입이 한쪽은 text, 한쪽은 uuid 라
      // 직접 비교하면 "operator does not exist: text = uuid" 가 난다 → 양쪽을 text 로 통일해 비교.
      `SELECT d.parse_run_id, d.status, d.result, d.error, d.created_at, d.analyzed_at,
              r.friendly_id, h.name AS hospital_name
         FROM health_report.blog_draft_diffs d
         LEFT JOIN chart_pdf.parse_runs r ON r.id::text = d.parse_run_id::text
         LEFT JOIN core.hospitals h ON h.id::text = d.hospital_id::text
        ORDER BY d.created_at DESC
        LIMIT $1`,
      [limit],
    );
    return NextResponse.json({
      items: rows.map((r) => ({
        runId: r.parse_run_id,
        status: r.status,
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
