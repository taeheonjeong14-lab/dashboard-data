import { NextRequest, NextResponse } from 'next/server';
import { hashShareToken } from '@/lib/chart-app/share-token';
import { getChartPgPool } from '@/lib/db';
import { loadReportSourceData } from '@/lib/chart-app/report-source';
import { buildHealthReportPreviewModel } from '@/lib/chart-app/health-report-preview-model';
import { parseHealthCheckupPayloadFromStorage } from '@/lib/chart-app/health-checkup-content-llm';
import { hospitalRowFromDb } from '@/lib/chart-app/hospital-db';
import { signImageSlotsInBlocks } from '@/lib/chart-app/health-report-blocks-sign-images';
import { applyPublicShareReviewCors, sharePublicCorsHeadersSnapshot } from '@/lib/chart-app/share-public-cors';

const LINK_CONTENT_TYPE = 'health_checkup';
const LEGACY_LINK_CONTENT_TYPE = 'health-checkup';
const GENERATED_CONTENT_TYPE = 'health_checkup';

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: sharePublicCorsHeadersSnapshot(request) });
}

// POST /api/report/health-checkup/preview-by-share
// Body: { token, generatedPayload? }
// Returns: { runId, model }
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return applyPublicShareReviewCors(NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }), request);
  }

  const token = String(body.token ?? '').trim();
  if (!token)
    return applyPublicShareReviewCors(NextResponse.json({ error: 'token required' }, { status: 400 }), request);

  try {
    const pool = getChartPgPool();
    const hash = hashShareToken(token);
    const link = await pool.query<{ parse_run_id: string; expires_at: Date; revoked_at: Date | null }>(
      `SELECT parse_run_id, expires_at, revoked_at
       FROM health_report.health_review_share_links
       WHERE token_hash = $1 AND content_type IN ($2, $3)
       LIMIT 1`,
      [hash, LINK_CONTENT_TYPE, LEGACY_LINK_CONTENT_TYPE],
    );
    const row = link.rows[0];
    if (!row || row.revoked_at || row.expires_at.getTime() < Date.now())
      return applyPublicShareReviewCors(NextResponse.json({ error: 'Forbidden' }, { status: 403 }), request);

    const runId = row.parse_run_id;

    let rawPayload: unknown;
    if (body.generatedPayload !== undefined && body.generatedPayload !== null) {
      rawPayload = body.generatedPayload;
    } else {
      const gen = await pool.query<{ payload: unknown }>(
        `SELECT payload FROM health_report.generated_run_content WHERE parse_run_id = $1::uuid AND content_type = $2 LIMIT 1`,
        [runId, GENERATED_CONTENT_TYPE],
      );
      rawPayload = gen.rows[0]?.payload;
      if (!rawPayload)
        return applyPublicShareReviewCors(NextResponse.json({ error: 'generated content not found' }, { status: 404 }), request);
    }

    const generated = parseHealthCheckupPayloadFromStorage(rawPayload);

    const pr = await pool.query<{ hospital_id: string | null }>(
      `SELECT hospital_id FROM chart_pdf.parse_runs WHERE id = $1::uuid LIMIT 1`,
      [runId],
    );
    const hospitalId = pr.rows[0]?.hospital_id ?? null;
    let hospital = null;
    if (hospitalId) {
      const { rows } = await pool.query(`SELECT * FROM core.hospitals WHERE id::text = $1 LIMIT 1`, [String(hospitalId)]);
      hospital = hospitalRowFromDb(rows[0] ?? null);
    }

    const source = await loadReportSourceData(runId);
    const model = buildHealthReportPreviewModel({ source, generated, hospital });

    await Promise.all([
      signImageSlotsInBlocks(model.systemsPage4Blocks),
      signImageSlotsInBlocks(model.systemsPage5Blocks),
    ]);

    return applyPublicShareReviewCors(NextResponse.json({ runId, model }), request);
  } catch (e) {
    console.error('POST preview-by-share:', e);
    return applyPublicShareReviewCors(
      NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 }),
      request,
    );
  }
}
