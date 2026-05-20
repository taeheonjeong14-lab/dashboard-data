import { NextResponse } from 'next/server';
import { PARSE_RUN_UUID_RE, parseRunExists } from '@/lib/parse-run-check';
import { hospitalRowFromDb } from '@/lib/chart-app/hospital-db';
import { chartExportRequestIdHeaders, resolveChartExportRequestId } from '@/lib/chart-app/export-request-id';
import { buildHealthCheckupPrintUrlForRequest } from '@/lib/chart-app/health-checkup-export-print-url';
import { getChartPgPool } from '@/lib/db';
import type { HospitalRow } from '@/lib/chart-app/hospitals-types';
import { getHealthCheckupGeneratedContentForRun } from '@/lib/generated-run-content';
import { loadRunBasicsForPdfBasename } from '@/lib/report-source-pdf-basename';
import {
  asciiHealthCheckupReportFallback,
  buildHealthCheckupPdfBasename,
  contentDispositionAttachmentUtf8,
} from '@/lib/health-checkup-pdf-filename';
import { renderPdfFromPageUrl } from '@/lib/playwright-browser';

/** PDF(Playwright 내부에서 인쇄 URL까지 열기) — 기본 serverless 제한보다 길게 */
export const maxDuration = 120;
export const runtime = 'nodejs';

type ParseRunHospitalJoinRow = {
  friendly_id: string | null;
  hospital_id: string | null;
  hospitals: HospitalRow | HospitalRow[] | null;
};

/** JSON · application/x-www-form-urlencoded · multipart/form-data */
async function parseHealthCheckupExportBody(request: Request): Promise<{
  runId: string;
  exportRequestIdFallback: string | null;
}> {
  const ct = (request.headers.get('content-type') ?? '').toLowerCase();

  if (ct.includes('application/json')) {
    const raw = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const runId = typeof raw?.runId === 'string' ? raw.runId.trim() : '';
    const exportRequestId =
      typeof raw?.exportRequestId === 'string'
        ? raw.exportRequestId.trim()
        : typeof raw?.export_request_id === 'string'
          ? raw.export_request_id.trim()
          : '';
    return { runId, exportRequestIdFallback: exportRequestId || null };
  }

  try {
    const fd = await request.formData();
    const runId = String(fd.get('runId') ?? '').trim();
    const exportRequestId =
      String(fd.get('exportRequestId') ?? fd.get('export_request_id') ?? '').trim() || null;
    return { runId, exportRequestIdFallback: exportRequestId };
  } catch {
    return { runId: '', exportRequestIdFallback: null };
  }
}

async function healthCheckupExportPdf(
  request: Request,
  runId: string,
  exportRequestIdFallback: string | null,
): Promise<NextResponse> {
  let requestId: string | undefined;
  try {
    requestId = resolveChartExportRequestId(request, exportRequestIdFallback);
    const idHeaders = chartExportRequestIdHeaders(requestId);

    if (!runId || !PARSE_RUN_UUID_RE.test(runId)) {
      return NextResponse.json(
        { error: '유효한 runId가 필요합니다.', requestId },
        { status: 400, headers: idHeaders },
      );
    }

    console.info(`[export-pdf] rid=${requestId} runId=${runId} stage=start`);

    const runOk = await parseRunExists(runId);
    if (!runOk) {
      return NextResponse.json(
        { error: '해당 케이스를 찾을 수 없습니다.', requestId },
        { status: 404, headers: idHeaders },
      );
    }

    const pool = getChartPgPool();
    const [basics, runRes, generatedRow] = await Promise.all([
      loadRunBasicsForPdfBasename(runId),
      pool.query<{ friendly_id: string | null; hospital_id: string | null }>(
        `SELECT friendly_id, hospital_id FROM chart_pdf.parse_runs WHERE id = $1::uuid LIMIT 1`,
        [runId],
      ),
      getHealthCheckupGeneratedContentForRun(null, runId),
    ]);

    const joinRow = (runRes.rows[0] ?? null) as unknown as ParseRunHospitalJoinRow | null;

    let hospitalRow: HospitalRow | null = null;
    if (joinRow?.hospital_id) {
      const { rows } = await pool.query(`SELECT * FROM core.hospitals WHERE id::text = $1 LIMIT 1`, [
        String(joinRow.hospital_id),
      ]);
      hospitalRow = hospitalRowFromDb(rows[0] ?? null);
    }

    const payload = generatedRow?.payload;

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

    const printUrl = buildHealthCheckupPrintUrlForRequest(request.url, runId);
    console.info(
      `[export-pdf] rid=${requestId} runId=${runId} stage=before_pdf printUrl=${printUrl}`,
    );

    const tPdf = Date.now();
    const pdf = await renderPdfFromPageUrl(printUrl, { requestId });
    console.info(`[export-pdf] rid=${requestId} runId=${runId} stage=pdf_done ms=${Date.now() - tPdf}`);

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': disposition,
        ...idHeaders,
      },
    });
  } catch (e) {
    const rid = requestId ?? resolveChartExportRequestId(request, exportRequestIdFallback);
    const message = e instanceof Error ? e.message : '알 수 없는 오류';
    console.error(`[export-pdf] rid=${rid} stage=error`, e);
    return NextResponse.json(
      { error: message, requestId: rid },
      { status: 500, headers: chartExportRequestIdHeaders(rid) },
    );
  }
}

/** GET ?runId= &exportRequestId= (또는 export_request_id) — vet-report 와 동일 계약 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const runId = url.searchParams.get('runId')?.trim() ?? '';
  const exportRequestIdFallback =
    url.searchParams.get('exportRequestId')?.trim() ||
    url.searchParams.get('export_request_id')?.trim() ||
    null;
  return healthCheckupExportPdf(request, runId, exportRequestIdFallback);
}

export async function POST(request: Request) {
  const parsed = await parseHealthCheckupExportBody(request);
  return healthCheckupExportPdf(request, parsed.runId, parsed.exportRequestIdFallback);
}
