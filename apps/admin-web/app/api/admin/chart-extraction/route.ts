import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { parseChartKind, type ChartKind } from '@/lib/chart-extraction/chart-kind';
import { downloadStorageObject } from '@/lib/chart-extraction/storage-object';
import { getAdminWebPgPool } from '@/lib/db';
import { getPdfUploadsBucket } from '@/lib/chart-extraction/storage-config';
import { isAllowedPdfExtractPath } from '@/lib/chart-extraction/upload-path';
import { hospitalExistsForParseRun } from '@/lib/chart-extraction/hospital-gate';

const MAX_FILE_SIZE_BYTES = 30 * 1024 * 1024;
const HOSPITAL_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const maxDuration = 120;

type BucketingParsedInput = {
  chartType: ChartKind;
  hospitalId: string;
  buffer: Buffer;
  fileName: string;
  fileType: string;
  storageBucket: string | null;
  storagePath: string | null;
  chartPasteText: string;
  efriendsChartBlocks: unknown | null;
};

function basenameFromPath(p: string): string {
  const seg = p.replace(/\\/g, '/').split('/').pop()?.trim();
  return seg || 'upload.pdf';
}

function resolveHospitalInputId(camel: unknown, snake: unknown): string {
  const a = typeof camel === 'string' ? camel.trim() : '';
  if (a) return a;
  return typeof snake === 'string' ? snake.trim() : '';
}

function formDataStringField(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === 'string' ? v : '';
}

function parseEfriendsBlocksRaw(raw: unknown): unknown | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

async function parseMultipart(request: NextRequest): Promise<BucketingParsedInput> {
  const form = await request.formData();
  const chartKind = parseChartKind(form.get('chartType'));
  if (!chartKind) throw new Error('INVALID_CHART_TYPE');
  const hospitalId = resolveHospitalInputId(
    formDataStringField(form, 'hospitalId'),
    formDataStringField(form, 'hospital_id'),
  );
  if (!hospitalId || !HOSPITAL_UUID_RE.test(hospitalId)) throw new Error('INVALID_HOSPITAL_ID');

  const chartPasteRaw = form.get('chartPasteText');
  const chartPasteText = typeof chartPasteRaw === 'string' ? chartPasteRaw.trim() : '';
  const efriendsChartBlocks = parseEfriendsBlocksRaw(form.get('efriendsChartBlocksJson'));

  const file = form.get('file');
  const storageBucketRaw = form.get('storageBucket');
  const storagePathRaw = form.get('storagePath');
  const storageFileNameRaw = form.get('fileName');
  const storageFileTypeRaw = form.get('fileType');
  const pdfBucket = getPdfUploadsBucket();

  if (file instanceof File) {
    if (file.type !== 'application/pdf') throw new Error('FILE_NOT_PDF');
    if (file.size > MAX_FILE_SIZE_BYTES) throw new Error('FILE_TOO_LARGE');
    const buf = Buffer.from(await file.arrayBuffer());
    const name = file.name?.trim() || 'report.pdf';
    return {
      chartType: chartKind,
      hospitalId,
      buffer: buf,
      fileName: name,
      fileType: file.type || 'application/pdf',
      storageBucket: null,
      storagePath: null,
      chartPasteText,
      efriendsChartBlocks,
    };
  }

  const storageBucket = typeof storageBucketRaw === 'string' ? storageBucketRaw.trim() : '';
  const storagePath = typeof storagePathRaw === 'string' ? storagePathRaw.trim() : '';
  const storageFileName = typeof storageFileNameRaw === 'string' ? storageFileNameRaw.trim() : '';
  const storageFileType =
    typeof storageFileTypeRaw === 'string' ? storageFileTypeRaw.trim().toLowerCase() : '';
  if (!storageBucket || !storagePath) throw new Error('MISSING_FILE_OR_STORAGE');
  if (storageBucket !== pdfBucket) throw new Error('STORAGE_BUCKET_NOT_ALLOWED');
  if (!isAllowedPdfExtractPath(storagePath)) throw new Error('STORAGE_PATH_NOT_ALLOWED');
  if (storageFileType && storageFileType !== 'application/pdf') throw new Error('FILE_NOT_PDF');

  const buffer = await downloadStorageObject({ bucket: storageBucket, path: storagePath });
  if (buffer.length > MAX_FILE_SIZE_BYTES) throw new Error('FILE_TOO_LARGE');
  return {
    chartType: chartKind,
    hospitalId,
    buffer,
    fileName: storageFileName || basenameFromPath(storagePath),
    fileType: storageFileType || 'application/pdf',
    storageBucket,
    storagePath,
    chartPasteText,
    efriendsChartBlocks,
  };
}

async function parseJson(request: NextRequest): Promise<BucketingParsedInput> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    throw new Error('INVALID_JSON');
  }
  const chartKind = parseChartKind(body.chartType);
  if (!chartKind) throw new Error('INVALID_CHART_TYPE');
  const hospitalId = resolveHospitalInputId(body.hospitalId, body.hospital_id);
  if (!hospitalId || !HOSPITAL_UUID_RE.test(hospitalId)) throw new Error('INVALID_HOSPITAL_ID');
  const chartPasteText =
    typeof body.chartPasteText === 'string' ? body.chartPasteText.trim() : '';
  const efriendsChartBlocks = parseEfriendsBlocksRaw(body.efriendsChartBlocksJson);
  const storagePath = typeof body.storagePath === 'string' ? body.storagePath.trim() : '';
  const defaultPdfBucket = getPdfUploadsBucket();
  const storageBucket =
    typeof body.bucket === 'string' && body.bucket.trim()
      ? body.bucket.trim()
      : typeof body.storageBucket === 'string' && body.storageBucket.trim()
        ? body.storageBucket.trim()
        : defaultPdfBucket;
  if (!storagePath) throw new Error('MISSING_STORAGE_PATH_JSON');
  if (storageBucket !== defaultPdfBucket) throw new Error('STORAGE_BUCKET_NOT_ALLOWED');
  if (!isAllowedPdfExtractPath(storagePath)) throw new Error('STORAGE_PATH_NOT_ALLOWED');
  const fileType =
    typeof body.fileType === 'string' && body.fileType.trim()
      ? body.fileType.trim().toLowerCase()
      : 'application/pdf';
  if (fileType !== 'application/pdf') throw new Error('FILE_NOT_PDF');
  const buffer = await downloadStorageObject({ bucket: storageBucket, path: storagePath });
  if (buffer.length > MAX_FILE_SIZE_BYTES) throw new Error('FILE_TOO_LARGE');
  return {
    chartType: chartKind,
    hospitalId,
    buffer,
    fileName:
      typeof body.fileName === 'string' && body.fileName.trim()
        ? body.fileName.trim()
        : basenameFromPath(storagePath),
    fileType,
    storageBucket,
    storagePath,
    chartPasteText,
    efriendsChartBlocks,
  };
}

async function parseRequest(request: NextRequest): Promise<BucketingParsedInput> {
  const ct = request.headers.get('content-type') || '';
  if (ct.includes('multipart/form-data')) return parseMultipart(request);
  return parseJson(request);
}

export async function POST(request: NextRequest) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const chartApiUrl = process.env.CHART_API_BASE_URL?.replace(/\/$/, '');
  const chartApiKey = process.env.CHART_APP_API_KEY;
  if (!chartApiUrl || !chartApiKey) {
    return NextResponse.json(
      { error: 'chart-api 설정이 없습니다. (CHART_API_BASE_URL, CHART_APP_API_KEY)' },
      { status: 500 },
    );
  }

  let input: BucketingParsedInput;
  try {
    input = await parseRequest(request);
  } catch (e) {
    const code = (e as Error).message;
    const map: Record<string, { status: number; error: string }> = {
      INVALID_JSON: { status: 400, error: 'Invalid JSON body' },
      INVALID_CHART_TYPE: {
        status: 400,
        error: 'chartType은 intovet | plusvet | efriends | woorien_pms 중 하나여야 합니다.',
      },
      INVALID_HOSPITAL_ID: {
        status: 400,
        error: '병원을 선택해 주세요. (hospitalId 또는 hospital_id, UUID)',
      },
      FILE_NOT_PDF: { status: 400, error: 'PDF만 지원합니다. (application/pdf)' },
      FILE_TOO_LARGE: { status: 400, error: '파일 크기는 30MB 이하여야 합니다.' },
      MISSING_FILE_OR_STORAGE: { status: 400, error: '업로드 파일 또는 storage 경로가 필요합니다.' },
      MISSING_STORAGE_PATH_JSON: { status: 400, error: 'JSON 요청에는 storagePath가 필요합니다.' },
      STORAGE_BUCKET_NOT_ALLOWED: {
        status: 400,
        error: `허용되지 않은 storage bucket입니다. (${getPdfUploadsBucket()} 만 허용)`,
      },
      STORAGE_PATH_NOT_ALLOWED: {
        status: 400,
        error: '허용되지 않은 storage path입니다. (extract-uploads/ 접두사 필요)',
      },
    };
    const m = map[code];
    if (m) return NextResponse.json({ error: m.error }, { status: m.status });
    return NextResponse.json({ error: code || 'Invalid request body' }, { status: 400 });
  }

  const pool = getAdminWebPgPool();
  const hospitalOk = await hospitalExistsForParseRun(pool, input.hospitalId);
  if (!hospitalOk) {
    return NextResponse.json(
      { error: '등록되지 않은 병원입니다. hospitalId / hospital_id 를 확인해 주세요.' },
      { status: 400 },
    );
  }

  try {
    let proxyRes: Response;

    // chart-api text-bucketing은 FormData만 파싱하므로 항상 FormData로 전송한다.
    // storagePath가 있으면 file bytes 대신 경로 필드만 포함 → chart-api가 Supabase에서 직접 다운로드.
    const proxyForm = new FormData();
    proxyForm.set('chartType', input.chartType);
    proxyForm.set('hospitalId', input.hospitalId);
    if (input.chartPasteText) proxyForm.set('chartPasteText', input.chartPasteText);
    if (input.efriendsChartBlocks != null) {
      proxyForm.set('efriendsChartBlocksJson', JSON.stringify(input.efriendsChartBlocks));
    }
    if (input.storagePath && input.storageBucket) {
      proxyForm.set('storageBucket', input.storageBucket);
      proxyForm.set('storagePath', input.storagePath);
      proxyForm.set('fileName', input.fileName);
      proxyForm.set('fileType', input.fileType);
    } else {
      const pdfBlob = new Blob([new Uint8Array(input.buffer)], { type: 'application/pdf' });
      proxyForm.set('file', pdfBlob, input.fileName);
    }
    console.log('[chart-extraction] chart-api 요청: chartType=%s hospitalId=%s storagePath=%s hasFile=%s',
      input.chartType, input.hospitalId, input.storagePath || '(없음)', !input.storagePath);
    proxyRes = await fetch(`${chartApiUrl}/api/text-bucketing`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${chartApiKey}` },
      body: proxyForm,
    });
    console.log('[chart-extraction] chart-api 응답: HTTP %d', proxyRes.status);

    const proxyText = await proxyRes.text();
    let proxyPayload: { runId?: string; friendlyId?: string; error?: string; _debug?: unknown };
    try {
      proxyPayload = JSON.parse(proxyText) as typeof proxyPayload;
    } catch {
      // chart-api가 plain text로 응답한 경우 (413 등)
      if (proxyRes.status === 413 || /request entity too large/i.test(proxyText)) {
        return NextResponse.json(
          { error: '파일이 너무 큽니다. chart-api 서버의 업로드 용량 제한을 초과했습니다.' },
          { status: 413 },
        );
      }
      console.error('chart-api non-JSON response:', proxyRes.status, proxyText.slice(0, 200));
      return NextResponse.json(
        { error: `추출 서비스 응답을 파싱할 수 없습니다. (HTTP ${proxyRes.status})` },
        { status: 500 },
      );
    }

    if (!proxyRes.ok) {
      console.error('chart-api text-bucketing error:', proxyRes.status, proxyPayload);
      return NextResponse.json(
        { error: proxyPayload.error ?? '추출 서비스 오류가 발생했습니다.' },
        { status: proxyRes.status >= 400 && proxyRes.status < 600 ? proxyRes.status : 500 },
      );
    }
    if (!proxyPayload.runId) {
      return NextResponse.json(
        { error: '추출은 완료되었으나 실행 ID를 받지 못했습니다.' },
        { status: 500 },
      );
    }

    console.log('[chart-extraction] _debug:', JSON.stringify(proxyPayload._debug ?? {}).slice(0, 500));
    return NextResponse.json({
      runId: proxyPayload.runId,
      friendlyId: proxyPayload.friendlyId ?? null,
      _debug: proxyPayload._debug ?? null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('chart-extraction proxy error:', msg);
    if (msg.includes('Object not found') || msg.includes('not found')) {
      return NextResponse.json({ error: 'Storage에서 파일을 찾을 수 없습니다.' }, { status: 404 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
