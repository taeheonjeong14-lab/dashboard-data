import { NextRequest, NextResponse } from 'next/server';
import { hashShareToken } from '@/lib/chart-app/share-token';
import { hospitalRowFromDb } from '@/lib/chart-app/hospital-db';
import type { HospitalRow } from '@/lib/chart-app/hospitals-types';
import { getHealthCheckupGeneratedContentForRun } from '@/lib/generated-run-content';
import { loadRunBasicsForPdfBasename } from '@/lib/report-source-pdf-basename';
import {
  asciiHealthCheckupReportFallback,
  buildHealthCheckupPdfBasename,
  contentDispositionAttachmentUtf8,
} from '@/lib/health-checkup-pdf-filename';
import { renderPdfFromPageUrl } from '@/lib/playwright-browser';
import { getChartPgPool } from '@/lib/db';
import {
  applyPublicShareReviewCors,
  sharePublicCorsHeadersSnapshot,
} from '@/lib/chart-app/share-public-cors';
import { chartExportRequestIdHeaders, resolveChartExportRequestId } from '@/lib/chart-app/export-request-id';
import { buildHealthCheckupPrintUrlForRequest } from '@/lib/chart-app/health-checkup-export-print-url';
import { buildHealthCheckupSharePrintUrl } from '@/lib/chart-app/health-checkup-print-url';

// POST /api/report/health-checkup/export-by-share — 토큰 검증 후 **토큰 경로** 인쇄 URL → PDF (vet-report 와 동일)
export const maxDuration = 120;
export const runtime = 'nodejs';
const LINK_CONTENT_TYPE = 'health_checkup';
const LEGACY_LINK_CONTENT_TYPE = 'health-checkup';
const GENERATED_CONTENT_TYPE = 'health_checkup';
type ParseRunHospitalJoinRow = {
  friendly_id: string | null;
  hospital_id: string | null;
  hospitals: HospitalRow | HospitalRow[] | null;
};

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: sharePublicCorsHeadersSnapshot(request) });
}

export async function POST(request: NextRequest) {
  const requestId = resolveChartExportRequestId(request);
  const ridHeaders = chartExportRequestIdHeaders(requestId);

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
    const hashPrefix = hash.slice(0, 10);
    const { rows } = await pool.query<{
      expires_at: Date;
      revoked_at: Date | null;
      parse_run_id: string;
    }>(
      `SELECT expires_at, revoked_at, parse_run_id FROM health_report.health_review_share_links WHERE token_hash = $1 AND content_type IN ($2, $3) LIMIT 1`,
      [hash, LINK_CONTENT_TYPE, LEGACY_LINK_CONTENT_TYPE],
    );
    const row = rows[0];
    if (!row) {
      console.warn('[review-share:export] forbidden:not_found', { hashPrefix });
      return applyPublicShareReviewCors(NextResponse.json({ error: 'Forbidden' }, { status: 403 }), request);
    }
    if (row.revoked_at) {
      console.warn('[review-share:export] forbidden:revoked', { hashPrefix, runId: row.parse_run_id });
      return applyPublicShareReviewCors(NextResponse.json({ error: 'Forbidden' }, { status: 403 }), request);
    }
    if (row.expires_at.getTime() < Date.now()) {
      console.warn('[review-share:export] forbidden:expired', {
        hashPrefix,
        runId: row.parse_run_id,
        expiresAt: row.expires_at.toISOString(),
      });
      return applyPublicShareReviewCors(NextResponse.json({ error: 'Forbidden' }, { status: 403 }), request);
    }

    await pool.query(
      `UPDATE health_report.health_review_share_links SET last_accessed_at = now(), updated_at = now() WHERE token_hash = $1 AND content_type IN ($2, $3)`,
      [hash, LINK_CONTENT_TYPE, LEGACY_LINK_CONTENT_TYPE],
    );

    const runId = row.parse_run_id;
    const [basics, runRes, generatedRow] = await Promise.all([
      loadRunBasicsForPdfBasename(runId),
      pool.query<{ friendly_id: string | null; hospital_id: string | null }>(
        `SELECT friendly_id, hospital_id FROM chart_pdf.parse_runs WHERE id = $1::uuid LIMIT 1`,
        [runId],
      ),
      getHealthCheckupGeneratedContentForRun(null, runId),
    ]);
    if (!generatedRow) {
      return applyPublicShareReviewCors(
        NextResponse.json({ error: 'generated content not found' }, { status: 404 }),
        request,
      );
    }
    const joinRow = (runRes.rows[0] ?? null) as unknown as ParseRunHospitalJoinRow | null;
    let hospitalRow: HospitalRow | null = null;
    if (joinRow?.hospital_id) {
      const { rows: hospitals } = await pool.query(`SELECT * FROM core.hospitals WHERE id::text = $1 LIMIT 1`, [
        String(joinRow.hospital_id),
      ]);
      hospitalRow = hospitalRowFromDb(hospitals[0] ?? null);
    }
    const payload = generatedRow.payload;
    const utf8Basename = buildHealthCheckupPdfBasename({
      hospitalNameKo: hospitalRow?.name_ko?.trim() || basics.hospitalNameFromBasic?.trim() || '병원',
      patientName: payload?.coverPatientName?.trim() || basics.patientNameFromBasic?.trim() || '환자',
      programName: payload?.coverProgram?.trim() ?? '',
      coverCheckupDate: payload?.coverCheckupDate,
      runCreatedAtIso: basics.runCreatedAtIso,
    });
    const disposition = contentDispositionAttachmentUtf8(
      utf8Basename,
      asciiHealthCheckupReportFallback(joinRow?.friendly_id),
    );

    const printUrl = buildHealthCheckupSharePrintUrl(token) ?? buildHealthCheckupPrintUrlForRequest(request.url, runId);
    console.info(`[pdf-export-by-share] rid=${requestId} runId=${runId} stage=before_pdf printUrl=${printUrl}`);

    const pdf = await renderPdfFromPageUrl(printUrl, { requestId });

    const pdfRes = new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': disposition,
        'Cache-Control': 'no-store',
        ...ridHeaders,
      },
    });
    return applyPublicShareReviewCors(pdfRes, request, {
      exposeHeaders: 'Content-Disposition, X-Chart-Export-Request-Id',
    });
  } catch (e) {
    console.error(`POST export-by-share rid=${requestId}`, e);
    const res = NextResponse.json(
      { error: e instanceof Error ? e.message : String(e), requestId },
      { status: 500, headers: ridHeaders },
    );
    return applyPublicShareReviewCors(res, request);
  }
}
