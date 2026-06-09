import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { getAdminWebPgPool } from '@/lib/db';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { analyzeImageGroup, type ImageInputPart } from '@/lib/chart-case-images/analyze';
import { prepareImageForAnalysis } from '@/lib/chart-case-images/encode';
import type { ExamType, RadiologySub, FindingSpot } from '@/lib/chart-case-images/types';

export const dynamic = 'force-dynamic';
// 이미지가 많은 그룹은 비전 분석을 청크로 순차 처리 + 429 백오프 재시도하므로 시간 여유를 둔다.
export const maxDuration = 300;

const CASE_IMAGES_BUCKET = 'chart-case-images';
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB per image (upload limit)
const MAX_IMAGES = 50;
const MAX_TOTAL_UPLOAD_BYTES = 160 * 1024 * 1024; // 160 MB total

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
      content_hash text,
      created_at timestamptz DEFAULT now()
    )
  `);
  await pool.query(
    `ALTER TABLE chart_pdf.parse_run_case_images ADD COLUMN IF NOT EXISTS content_hash text`,
  );
  await pool.query(
    `ALTER TABLE chart_pdf.parse_run_case_images ADD COLUMN IF NOT EXISTS exam_date date`,
  );
  await pool.query(
    `ALTER TABLE chart_pdf.parse_run_case_images ADD COLUMN IF NOT EXISTS body_part text`,
  );
  await pool.query(`
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE chart_pdf.parse_run_case_images TO service_role;
    GRANT SELECT ON TABLE chart_pdf.parse_run_case_images TO authenticated;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chart_pdf.parse_run_case_image_summaries (
      parse_run_id uuid NOT NULL,
      exam_date date,
      bullets jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_at timestamptz DEFAULT now()
    )
  `);
  await pool.query(`
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE chart_pdf.parse_run_case_image_summaries TO service_role;
    GRANT SELECT ON TABLE chart_pdf.parse_run_case_image_summaries TO authenticated;
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
    await ensureTable(pool); // exam_date 등 누락 컬럼 self-heal 후 SELECT
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
      exam_date: string | null;
      body_part: string | null;
      created_at: string;
    }>(
      `SELECT id, idx, file_name, storage_path, exam_type, radiology_sub,
              has_notable_finding, is_clear_finding, brief_comment, finding_spots,
              related_assessment_condition, exam_date, body_part, created_at
       FROM chart_pdf.parse_run_case_images
       WHERE parse_run_id = $1::uuid
       ORDER BY idx ASC`,
      [runId],
    );

    if (rows.length === 0) {
      return NextResponse.json({ images: [], summaries: [] });
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
          examDate: row.exam_date,
          bodyPart: row.body_part,
          createdAt: row.created_at,
        };
      }),
    );

    const { rows: summaryRows } = await pool.query<{ exam_date: string | null; bullets: unknown }>(
      `SELECT exam_date, bullets FROM chart_pdf.parse_run_case_image_summaries WHERE parse_run_id = $1::uuid`,
      [runId],
    );
    const summaries = summaryRows.map((s) => ({
      examDate: s.exam_date,
      bullets: Array.isArray(s.bullets)
        ? (s.bullets as { text?: unknown; confidence?: unknown; fileNames?: unknown; imageConfidence?: unknown }[]).map((b) => ({
            text: typeof b?.text === 'string' ? b.text : '',
            confidence: typeof b?.confidence === 'number' ? b.confidence : null,
            fileNames: Array.isArray(b?.fileNames)
              ? (b.fileNames as unknown[]).filter((n): n is string => typeof n === 'string')
              : [],
            imageConfidence:
              b?.imageConfidence && typeof b.imageConfidence === 'object' && !Array.isArray(b.imageConfidence)
                ? (b.imageConfidence as Record<string, number>)
                : undefined,
          }))
        : [],
    }));

    return NextResponse.json({ images, summaries });
  } catch (e) {
    // Table may not exist yet
    if ((e as { code?: string }).code === '42P01') {
      return NextResponse.json({ images: [] });
    }
    console.error('GET case-images error:', e);
    return NextResponse.json({ error: '이미지 조회에 실패했습니다.' }, { status: 500 });
  }
}

type RawFile = { rawBuffer: Buffer; fileName: string; hash: string };

// POST /api/admin/runs/[runId]/case-images
// 입력 두 가지 지원:
//  - JSON { examDate, mode, uploads:[{path,fileName}] }: 클라이언트가 스토리지에 직접 업로드한 staging 경로.
//    이미지 바이트가 함수 본문을 거치지 않아 Vercel 요청 본문 4.5MB 한도를 우회한다(권장).
//  - multipart(이미지 파일 직접): 소량 업로드용 하위호환.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const { runId } = await params;
  const supabase = createServiceRoleClient();

  let examDate = '';
  let mode: string | undefined;
  let rawFiles: RawFile[] = [];
  const stagingPaths: string[] = []; // JSON 직접 업로드의 임시 파일(처리 후 삭제)

  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    let body: { examDate?: string; mode?: string; uploads?: { path?: string; fileName?: string }[] };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: '요청 형식이 올바르지 않습니다.' }, { status: 400 });
    }
    examDate = typeof body.examDate === 'string' ? body.examDate.trim() : '';
    mode = typeof body.mode === 'string' ? body.mode.trim() : undefined;
    const uploads = Array.isArray(body.uploads) ? body.uploads : [];
    if (uploads.length === 0) {
      return NextResponse.json({ error: '업로드된 이미지가 없습니다.' }, { status: 400 });
    }
    if (uploads.length > MAX_IMAGES) {
      return NextResponse.json({ error: `이미지는 최대 ${MAX_IMAGES}장까지 가능합니다.` }, { status: 400 });
    }
    // 경로는 반드시 이 runId 하위여야 함(임의 경로 주입 방지)
    for (const u of uploads) {
      if (typeof u?.path !== 'string' || !u.path.startsWith(`${runId}/`)) {
        return NextResponse.json({ error: '업로드 경로가 올바르지 않습니다.' }, { status: 400 });
      }
    }
    try {
      rawFiles = await Promise.all(
        uploads.map(async (u) => {
          const path = u.path as string;
          stagingPaths.push(path);
          const { data: blob, error } = await supabase.storage.from(CASE_IMAGES_BUCKET).download(path);
          if (error || !blob) throw new Error('업로드된 이미지를 불러오지 못했습니다.');
          const rawBuffer = Buffer.from(await blob.arrayBuffer());
          const hash = createHash('sha256').update(rawBuffer).digest('hex');
          return { rawBuffer, fileName: String(u.fileName || 'image'), hash };
        }),
      );
    } catch (e) {
      if (stagingPaths.length > 0) await supabase.storage.from(CASE_IMAGES_BUCKET).remove(stagingPaths).catch(() => {});
      return NextResponse.json({ error: e instanceof Error ? e.message : '이미지 불러오기 실패' }, { status: 400 });
    }
  } else {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ error: 'multipart 파싱 실패' }, { status: 400 });
    }
    examDate = (form.get('examDate') as string | null)?.trim() ?? '';
    mode = (form.get('mode') as string | null)?.trim() || undefined; // 'append' | undefined(replace)
    const imageFiles = form.getAll('images') as File[];
    if (imageFiles.length === 0) {
      return NextResponse.json({ error: '이미지 파일이 필요합니다.' }, { status: 400 });
    }
    if (imageFiles.length > MAX_IMAGES) {
      return NextResponse.json({ error: `이미지는 최대 ${MAX_IMAGES}개까지 업로드 가능합니다.` }, { status: 400 });
    }
    for (const file of imageFiles) {
      const mime = file.type.toLowerCase();
      if (!isAllowedMime(mime)) {
        return NextResponse.json({ error: `지원하지 않는 이미지 형식입니다: ${mime} (JPEG/PNG/WebP만 가능)` }, { status: 400 });
      }
    }
    rawFiles = await Promise.all(
      imageFiles.map(async (file) => {
        const rawBuffer = Buffer.from(await file.arrayBuffer());
        const hash = createHash('sha256').update(rawBuffer).digest('hex');
        return { rawBuffer, fileName: file.name || 'image', hash };
      }),
    );
  }

  // 공통 크기 검증
  const totalBytes = rawFiles.reduce((s, f) => s + f.rawBuffer.length, 0);
  if (totalBytes > MAX_TOTAL_UPLOAD_BYTES) {
    if (stagingPaths.length > 0) await supabase.storage.from(CASE_IMAGES_BUCKET).remove(stagingPaths).catch(() => {});
    return NextResponse.json(
      { error: `전체 파일 용량이 초과되었습니다. (${Math.round(totalBytes / 1024 / 1024)}MB / 허용 ${MAX_TOTAL_UPLOAD_BYTES / 1024 / 1024}MB)` },
      { status: 400 },
    );
  }
  for (const f of rawFiles) {
    if (f.rawBuffer.length > MAX_IMAGE_BYTES) {
      if (stagingPaths.length > 0) await supabase.storage.from(CASE_IMAGES_BUCKET).remove(stagingPaths).catch(() => {});
      return NextResponse.json({ error: `이미지 파일은 ${MAX_IMAGE_BYTES / 1024 / 1024}MB 이하여야 합니다. (${f.fileName})` }, { status: 400 });
    }
  }

  // 중복 체크는 DB 접근 후 수행하므로 압축은 deduped 기준으로 아래에서 처리

  const pool = getAdminWebPgPool();

  try {
    await ensureTable(pool);
    await ensureBucket(supabase);

    // append 모드: 기존 이미지 유지하고 idx 이어받기 / replace 모드: 기존 삭제
    let idxOffset = 0;
    const existingHashes = new Set<string>();
    if (mode === 'append') {
      const { rows: idxRows } = await pool.query<{ max_idx: number | null }>(
        'SELECT MAX(idx) AS max_idx FROM chart_pdf.parse_run_case_images WHERE parse_run_id = $1::uuid',
        [runId],
      );
      idxOffset = (idxRows[0]?.max_idx ?? -1) + 1;
      const { rows: hashRows } = await pool.query<{ content_hash: string | null }>(
        'SELECT content_hash FROM chart_pdf.parse_run_case_images WHERE parse_run_id = $1::uuid AND content_hash IS NOT NULL',
        [runId],
      );
      for (const r of hashRows) if (r.content_hash) existingHashes.add(r.content_hash);
    } else {
      const { rows: existing } = await pool.query<{ storage_path: string }>(
        'SELECT storage_path FROM chart_pdf.parse_run_case_images WHERE parse_run_id = $1::uuid',
        [runId],
      );
      if (existing.length > 0) {
        await supabase.storage.from(CASE_IMAGES_BUCKET).remove(existing.map((r) => r.storage_path));
        await pool.query('DELETE FROM chart_pdf.parse_run_case_images WHERE parse_run_id = $1::uuid', [runId]);
      }
    }

    // 중복 제거: 이미 저장된 해시 + 이번 배치 내 중복
    const seenHashes = new Set<string>(existingHashes);
    const deduped: RawFile[] = [];
    const skipped: string[] = [];
    for (const f of rawFiles) {
      if (seenHashes.has(f.hash)) {
        skipped.push(f.fileName);
      } else {
        seenHashes.add(f.hash);
        deduped.push(f);
      }
    }
    if (deduped.length === 0) {
      return NextResponse.json({ ok: true, count: 0, skipped, allSkipped: true });
    }

    // 중복 제거된 파일만 압축
    type ImagePartWithHash = ImageInputPart & { hash: string };
    let imageParts: ImagePartWithHash[];
    try {
      imageParts = await Promise.all(
        deduped.map(async ({ rawBuffer, fileName, hash }) => {
          const compressed = await prepareImageForAnalysis(rawBuffer);
          return { buffer: compressed.buffer, fileName, mimeType: compressed.mimeType, hash } satisfies ImagePartWithHash;
        }),
      );
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : '이미지 압축 실패' },
        { status: 400 },
      );
    }

    // append + 같은 날짜에 기존 이미지가 있으면, 그 날짜 그룹 시사점이 전체(기존+새)를 반영하도록
    // 기존 이미지도 다운로드해 함께 재분석한다. (insert/upload 는 새 이미지만; 시사점만 전체 기준 갱신)
    const priorParts: ImageInputPart[] = [];
    if (mode === 'append' && examDate) {
      const { rows: priorRows } = await pool.query<{ storage_path: string; file_name: string }>(
        `SELECT storage_path, file_name FROM chart_pdf.parse_run_case_images
         WHERE parse_run_id = $1::uuid AND exam_date IS NOT DISTINCT FROM $2
         ORDER BY idx ASC`,
        [runId, examDate || null],
      );
      for (const r of priorRows) {
        const { data: blob } = await supabase.storage.from(CASE_IMAGES_BUCKET).download(r.storage_path);
        if (!blob) continue;
        const buf = Buffer.from(await blob.arrayBuffer());
        const ext = r.storage_path.split('.').pop()?.toLowerCase();
        const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
        priorParts.push({ buffer: buf, fileName: r.file_name, mimeType });
      }
    }

    // Analyze with OpenAI (그룹 단위: 기존+새 이미지로 라벨 + 시사점)
    let analysis;
    try {
      analysis = await analyzeImageGroup({ examDate, images: [...priorParts, ...imageParts] });
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
        const storagePath = `${runId}/${idxOffset + i}_${safeFile}.${ext}`;

        const { error: uploadErr } = await supabase.storage
          .from(CASE_IMAGES_BUCKET)
          .upload(storagePath, img.buffer, {
            contentType: img.mimeType,
            upsert: true,
          });

        if (uploadErr) throw new Error(`이미지 업로드 실패: ${uploadErr.message}`);

        // 분석 결과는 [기존…, 새…] 순서라 새 이미지는 priorParts 이후 인덱스.
        const result = analysis.images[priorParts.length + i];
        return {
          idx: idxOffset + i,
          fileName: img.fileName,
          storagePath,
          contentHash: img.hash,
          examType: result?.examType ?? 'other',
          bodyPart: result?.bodyPart ?? '',
        };
      }),
    );

    // Insert into DB
    for (const img of savedImages) {
      await pool.query(
        `INSERT INTO chart_pdf.parse_run_case_images
          (parse_run_id, idx, file_name, storage_path, exam_type, body_part, content_hash, exam_date)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8)`,
        [
          runId,
          img.idx,
          img.fileName,
          img.storagePath,
          img.examType,
          img.bodyPart,
          img.contentHash,
          examDate || null,
        ],
      );
    }

    // 그룹 시사점 저장(이 examDate). append 시 같은 날짜 기존 시사점 교체.
    await pool.query(
      `DELETE FROM chart_pdf.parse_run_case_image_summaries
       WHERE parse_run_id = $1::uuid AND exam_date IS NOT DISTINCT FROM $2`,
      [runId, examDate || null],
    );
    if (analysis.bullets.length > 0) {
      await pool.query(
        `INSERT INTO chart_pdf.parse_run_case_image_summaries (parse_run_id, exam_date, bullets)
         VALUES ($1::uuid, $2, $3::jsonb)`,
        [runId, examDate || null, JSON.stringify(analysis.bullets)],
      );
    }

    return NextResponse.json({ ok: true, count: savedImages.length, skipped, allSkipped: false });
  } catch (e) {
    console.error('[case-images] POST error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '이미지 저장 실패' },
      { status: 500 },
    );
  } finally {
    // JSON 직접 업로드의 임시(staging) 파일 정리. 최종 이미지는 다른 경로에 저장되므로 항상 안전.
    if (stagingPaths.length > 0) {
      await supabase.storage.from(CASE_IMAGES_BUCKET).remove(stagingPaths).catch(() => {});
    }
  }
}

// DELETE /api/admin/runs/[runId]/case-images?imageId=...  — 개별 이미지 삭제(스토리지+DB)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const { runId } = await params;
  const imageId = request.nextUrl.searchParams.get('imageId')?.trim();
  if (!imageId) {
    return NextResponse.json({ error: 'imageId가 필요합니다.' }, { status: 400 });
  }

  const pool = getAdminWebPgPool();
  const supabase = createServiceRoleClient();

  try {
    const { rows } = await pool.query<{ storage_path: string }>(
      `SELECT storage_path FROM chart_pdf.parse_run_case_images
       WHERE parse_run_id = $1::uuid AND id = $2::uuid`,
      [runId, imageId],
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: '이미지를 찾을 수 없습니다.' }, { status: 404 });
    }
    await supabase.storage.from(CASE_IMAGES_BUCKET).remove([rows[0].storage_path]);
    await pool.query(
      `DELETE FROM chart_pdf.parse_run_case_images WHERE parse_run_id = $1::uuid AND id = $2::uuid`,
      [runId, imageId],
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[case-images] DELETE error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '이미지 삭제 실패' },
      { status: 500 },
    );
  }
}
