import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { getAdminWebPgPool } from '@/lib/db';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { analyzeCaseImages, type ImageInputPart } from '@/lib/chart-case-images/analyze';
import { prepareImageForAnalysis } from '@/lib/chart-case-images/encode';
import { ensureCaseImagesTable } from '@/lib/chart-case-images/ensure-table';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const HOSPITAL_BUCKET = 'case-image'; // hospital-ui 업로드 버킷
const CASE_IMAGES_BUCKET = 'chart-case-images'; // 분류 결과 저장 버킷

// POST /api/admin/runs/[runId]/case-images/from-hospital
// 병원(hospital-ui)이 제출한 이미지를 기존 분류 파이프라인(analyzeCaseImages)에 태워
// chart_pdf.parse_run_case_images 에 분류 결과와 함께 저장한다. 멱등(이미 분류돼 있으면 스킵).
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const { runId } = await params;
  const pool = getAdminWebPgPool();
  const supabase = createServiceRoleClient();

  try {
    // 테이블/누락 컬럼(content_hash)/grant self-heal — 일반 업로드 라우트와 동일.
    // 이게 없으면 content_hash 누락 DB 에서 아래 INSERT 가 전량 실패한다.
    await ensureCaseImagesTable(pool);

    // 멱등: 이미 case images 가 있으면 스킵
    const { rows: existing } = await pool.query<{ n: string }>(
      'SELECT COUNT(*)::text AS n FROM chart_pdf.parse_run_case_images WHERE parse_run_id = $1::uuid',
      [runId],
    );
    if (Number(existing[0]?.n ?? '0') > 0) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'already_has_case_images' });
    }

    // 병원 제출 이미지 경로 조회: 진료케이스(blog_case) 또는 건강검진(hospital_notes)의 payload.image_paths.
    // (진료케이스는 blog_case, 건강검진은 hospital_notes 로 저장되므로 둘 다 확인.)
    const { data: notesRows } = await supabase
      .schema('health_report')
      .from('generated_run_content')
      .select('content_type, payload')
      .eq('parse_run_id', runId)
      .in('content_type', ['blog_case', 'hospital_notes']);
    let imagePaths: string[] = [];
    for (const row of notesRows ?? []) {
      const pl = (row as { payload?: { image_paths?: unknown } }).payload;
      const paths = Array.isArray(pl?.image_paths)
        ? (pl!.image_paths as unknown[]).filter((p): p is string => typeof p === 'string' && p.length > 0)
        : [];
      if (paths.length > 0) {
        imagePaths = paths;
        break;
      }
    }
    if (imagePaths.length === 0) {
      return NextResponse.json({ ok: true, count: 0, reason: 'no_hospital_images' });
    }

    // 버킷에서 다운로드 → 버퍼 + 해시
    const downloaded: { rawBuffer: Buffer; fileName: string; hash: string }[] = [];
    for (const path of imagePaths) {
      const { data: blob, error } = await supabase.storage.from(HOSPITAL_BUCKET).download(path);
      if (error || !blob) continue;
      const rawBuffer = Buffer.from(await blob.arrayBuffer());
      const hash = createHash('sha256').update(rawBuffer).digest('hex');
      downloaded.push({ rawBuffer, fileName: path.split('/').pop() || 'image', hash });
    }
    if (downloaded.length === 0) {
      return NextResponse.json({ ok: true, count: 0, reason: 'download_failed' });
    }

    // 압축 → 분석
    const imageParts: (ImageInputPart & { hash: string })[] = await Promise.all(
      downloaded.map(async ({ rawBuffer, fileName, hash }) => {
        const c = await prepareImageForAnalysis(rawBuffer);
        return { buffer: c.buffer, fileName, mimeType: c.mimeType, hash };
      }),
    );
    const analysis = await analyzeCaseImages({ examDate: '', images: imageParts });

    // 분류 결과 저장 버킷 업로드 + DB insert
    for (let i = 0; i < imageParts.length; i++) {
      const img = imageParts[i];
      const ext = img.mimeType === 'image/png' ? 'png' : img.mimeType === 'image/webp' ? 'webp' : 'jpg';
      const safe = (img.fileName.replace(/\.[^.]+$/, '') || 'image').replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `${runId}/${i}_${safe}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(CASE_IMAGES_BUCKET)
        .upload(storagePath, img.buffer, { contentType: img.mimeType, upsert: true });
      if (upErr) continue;

      const r = analysis.images[i];
      await pool.query(
        `INSERT INTO chart_pdf.parse_run_case_images
          (parse_run_id, idx, file_name, storage_path, exam_type, radiology_sub,
           has_notable_finding, is_clear_finding, brief_comment, finding_spots,
           related_assessment_condition, content_hash)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          runId, i, img.fileName, storagePath,
          r?.examType ?? 'other', r?.radiologySub ?? null,
          r?.hasNotableFinding ?? false, r?.isClearFinding ?? false,
          r?.briefComment ?? '', r?.findingSpots ? JSON.stringify(r.findingSpots) : null,
          r?.relatedAssessmentCondition ?? null, img.hash,
        ],
      );
    }

    return NextResponse.json({ ok: true, count: imageParts.length });
  } catch (e) {
    console.error('POST case-images/from-hospital:', e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
