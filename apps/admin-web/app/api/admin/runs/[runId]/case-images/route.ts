import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { getAdminWebPgPool } from '@/lib/db';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { analyzeCaseImages, type ImageInputPart } from '@/lib/chart-case-images/analyze';
import { prepareImageForAnalysis } from '@/lib/chart-case-images/encode';
import type { ExamType, RadiologySub, FindingSpot } from '@/lib/chart-case-images/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const CASE_IMAGES_BUCKET = 'chart-case-images';
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB per image (upload limit)
const MAX_IMAGES = 20;
const MAX_TOTAL_UPLOAD_BYTES = MAX_IMAGE_BYTES * MAX_IMAGES;

type AllowedMime = (typeof ALLOWED_MIME_TYPES)[number];

function isAllowedMime(mime: string): mime is AllowedMime {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(mime);
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'image';
}

async function ensureTable(pool: ReturnType<typeof getAdminWebPgPool>) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chart_pdf.parse_run_case_images (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      parse_run_id uuid NOT NULL,
      idx integer NOT NULL,
      file_name text NOT NULL,
      storage_path text NOT NULL,
      exam_type text,
      radiology_sub text,
      has_notable_finding boolean DEFAULT false,
      is_clear_finding boolean DEFAULT false,
      brief_comment text,
      finding_spots jsonb,
      related_assessment_condition text,
      created_at timestamptz DEFAULT now()
    )
  `);
}

async function ensureBucket(supabase: ReturnType<typeof createServiceRoleClient>) {
  const { data: buckets } = await supabase.storage.listBuckets();
  const exists = buckets?.some((b) => b.name === CASE_IMAGES_BUCKET);
  if (!exists) {
    await supabase.storage.createBucket(CASE_IMAGES_BUCKET, { public: false });
  }
}

// GET /api/admin/runs/[runId]/case-images
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const { runId } = await params;
  const pool = getAdminWebPgPool();

  try {
    const { rows } = await pool.query<{
      id: string;
      idx: number;
      file_name: string;
      storage_path: string;
      exam_type: string | null;
      radiology_sub: string | null;
      has_notable_finding: boolean;
      is_clear_finding: boolean;
      brief_comment: string | null;
      finding_spots: FindingSpot[] | null;
      related_assessment_condition: string | null;
      created_at: string;
    }>(
      `SELECT id, idx, file_name, storage_path, exam_type, radiology_sub,
              has_notable_finding, is_clear_finding, brief_comment, finding_spots,
              related_assessment_condition, created_at
       FROM chart_pdf.parse_run_case_images
       WHERE parse_run_id = $1::uuid
       ORDER BY idx ASC`,
      [runId],
    );

    if (rows.length === 0) {
      return NextResponse.json({ images: [] });
    }

    const supabase = createServiceRoleClient();
    const images = await Promise.all(
      rows.map(async (row) => {
        const { data } = await supabase.storage
          .from(CASE_IMAGES_BUCKET)
          .createSignedUrl(row.storage_path, 3600);
        return {
          id: row.id,
          index: row.idx,
          fileName: row.file_name,
          signedUrl: data?.signedUrl ?? null,
          examType: row.exam_type as ExamType | null,
          radiologySub: row.radiology_sub as RadiologySub | null,
          hasNotableFinding: row.has_notable_finding,
          isClearFinding: row.is_clear_finding,
          briefComment: row.brief_comment ?? '',
          findingSpots: row.finding_spots ?? [],
          relatedAssessmentCondition: row.related_assessment_condition,
          createdAt: row.created_at,
        };
      }),
    );

    return NextResponse.json({ images });
  } catch (e) {
    // Table may not exist yet
    if ((e as { code?: string }).code === '42P01') {
      return NextResponse.json({ images: [] });
    }
    console.error('GET case-images error:', e);
    return NextResponse.json({ error: '이미지 조회에 실패했습니다.' }, { status: 500 });
  }
}

// POST /api/admin/runs/[runId]/case-images
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const { runId } = await params;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'multipart 파싱 실패' }, { status: 400 });
  }

  const examDate = (form.get('examDate') as string | null)?.trim() ?? '';
  const imageFiles = form.getAll('images') as File[];

  if (imageFiles.length === 0) {
    return NextResponse.json({ error: '이미지 파일이 필요합니다.' }, { status: 400 });
  }
  if (imageFiles.length > MAX_IMAGES) {
    return NextResponse.json({ error: `이미지는 최대 ${MAX_IMAGES}개까지 업로드 가능합니다.` }, { status: 400 });
  }

  // Validate upload sizes
  const totalBytes = imageFiles.reduce((s, f) => s + f.size, 0);
  if (totalBytes > MAX_TOTAL_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `전체 파일 용량이 초과되었습니다. (${Math.round(totalBytes / 1024 / 1024)}MB / 허용 ${MAX_TOTAL_UPLOAD_BYTES / 1024 / 1024}MB)` },
      { status: 400 },
    );
  }
  for (const file of imageFiles) {
    const mime = file.type.toLowerCase();
    if (!isAllowedMime(mime)) {
      return NextResponse.json({ error: `지원하지 않는 이미지 형식입니다: ${mime} (JPEG/PNG/WebP만 가능)` }, { status: 400 });
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: `이미지 파일은 ${MAX_IMAGE_BYTES / 1024 / 1024}MB 이하여야 합니다. (${file.name})` }, { status: 400 });
    }
  }

  // Load raw buffers, then compress each to WebP ≤512KB via sharp
  type RawFile = { rawBuffer: Buffer; fileName: string };
  const rawFiles: RawFile[] = await Promise.all(
    imageFiles.map(async (file) => ({
      rawBuffer: Buffer.from(await file.arrayBuffer()),
      fileName: file.name || 'image',
    })),
  );

  let imageParts: ImageInputPart[];
  try {
    imageParts = await Promise.all(
      rawFiles.map(async ({ rawBuffer, fileName }) => {
        const compressed = await prepareImageForAnalysis(rawBuffer);
        return { buffer: compressed.buffer, fileName, mimeType: compressed.mimeType } satisfies ImageInputPart;
      }),
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '이미지 압축 실패' },
      { status: 400 },
    );
  }

  const pool = getAdminWebPgPool();
  const supabase = createServiceRoleClient();

  try {
    await ensureTable(pool);
    await ensureBucket(supabase);

    // Delete existing images for this run
    const { rows: existing } = await pool.query<{ storage_path: string }>(
      'SELECT storage_path FROM chart_pdf.parse_run_case_images WHERE parse_run_id = $1::uuid',
      [runId],
    );
    if (existing.length > 0) {
      await supabase.storage.from(CASE_IMAGES_BUCKET).remove(existing.map((r) => r.storage_path));
      await pool.query('DELETE FROM chart_pdf.parse_run_case_images WHERE parse_run_id = $1::uuid', [runId]);
    }

    // Analyze with OpenAI
    let analysis;
    try {
      analysis = await analyzeCaseImages({ examDate, images: imageParts });
    } catch (e) {
      console.error('[case-images] analysis error:', e);
      return NextResponse.json(
        { error: e instanceof Error ? e.message : '이미지 분석 실패' },
        { status: 500 },
      );
    }

    // Upload images to Supabase Storage
    const savedImages = await Promise.all(
      imageParts.map(async (img, i) => {
        const ext = img.mimeType === 'image/png' ? 'png' : img.mimeType === 'image/webp' ? 'webp' : 'jpg';
        const safeFile = sanitizeFilename(img.fileName.replace(/\.[^.]+$/, ''));
        const storagePath = `${runId}/${i}_${safeFile}.${ext}`;

        const { error: uploadErr } = await supabase.storage
          .from(CASE_IMAGES_BUCKET)
          .upload(storagePath, img.buffer, {
            contentType: img.mimeType,
            upsert: true,
          });

        if (uploadErr) throw new Error(`이미지 업로드 실패: ${uploadErr.message}`);

        const result = analysis.images[i];
        return {
          idx: i,
          fileName: img.fileName,
          storagePath,
          examType: result?.examType ?? 'other',
          radiologySub: result?.radiologySub ?? null,
          hasNotableFinding: result?.hasNotableFinding ?? false,
          isClearFinding: result?.isClearFinding ?? false,
          briefComment: result?.briefComment ?? '',
          findingSpots: result?.findingSpots ?? null,
          relatedAssessmentCondition: result?.relatedAssessmentCondition ?? null,
        };
      }),
    );

    // Insert into DB
    for (const img of savedImages) {
      await pool.query(
        `INSERT INTO chart_pdf.parse_run_case_images
          (parse_run_id, idx, file_name, storage_path, exam_type, radiology_sub,
           has_notable_finding, is_clear_finding, brief_comment, finding_spots, related_assessment_condition)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          runId,
          img.idx,
          img.fileName,
          img.storagePath,
          img.examType,
          img.radiologySub,
          img.hasNotableFinding,
          img.isClearFinding,
          img.briefComment,
          img.findingSpots ? JSON.stringify(img.findingSpots) : null,
          img.relatedAssessmentCondition,
        ],
      );
    }

    return NextResponse.json({ ok: true, count: savedImages.length });
  } catch (e) {
    console.error('[case-images] POST error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '이미지 저장 실패' },
      { status: 500 },
    );
  }
}
