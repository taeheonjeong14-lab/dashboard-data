import { NextRequest, NextResponse } from 'next/server';
import { hashShareToken } from '@/lib/chart-app/share-token';
import { getChartPgPool } from '@/lib/db';
import { buildHealthCheckupSharePrintUrlForRequest } from '@/lib/chart-app/health-checkup-export-print-url';
import { getStoredReportPdfSignedUrl, renderAndStoreReportPdf } from '@/lib/chart-app/report-pdf-store';

// 보호자용 리포트 PDF 링크(카톡 버튼이 가리키는 곳). 저장본이 있으면 즉시 리다이렉트, 없으면 렌더 후 저장.
export const maxDuration = 120;
export const runtime = 'nodejs';

const LINK_CONTENT_TYPE = 'health_checkup';
const LEGACY_LINK_CONTENT_TYPE = 'health-checkup';

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 });

  try {
    const pool = getChartPgPool();
    const hash = hashShareToken(token);
    const { rows } = await pool.query<{ expires_at: Date; revoked_at: Date | null; parse_run_id: string }>(
      `SELECT expires_at, revoked_at, parse_run_id
       FROM health_report.health_review_share_links
       WHERE token_hash = $1 AND content_type IN ($2, $3)
       LIMIT 1`,
      [hash, LINK_CONTENT_TYPE, LEGACY_LINK_CONTENT_TYPE],
    );
    const row = rows[0];
    if (!row || row.revoked_at || row.expires_at.getTime() < Date.now()) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const runId = row.parse_run_id;
    let signedUrl = await getStoredReportPdfSignedUrl(runId);
    if (!signedUrl) {
      const printUrl = buildHealthCheckupSharePrintUrlForRequest(request.url, token);
      signedUrl = await renderAndStoreReportPdf(runId, printUrl);
    }
    return NextResponse.redirect(signedUrl, 302);
  } catch (e) {
    console.error('GET review .../pdf:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'PDF 생성 실패' }, { status: 500 });
  }
}
