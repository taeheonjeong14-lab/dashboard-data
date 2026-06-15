import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { getAdminWebPgPool } from '@/lib/db';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { analyzeImageGroup, type ImageInputPart } from '@/lib/chart-case-images/analyze';
import { prepareImageForAnalysis } from '@/lib/chart-case-images/encode';
import { ensureCaseImagesTable } from '@/lib/chart-case-images/ensure-table';

export const dynamic = 'force-dynamic';
// 병원 제출 이미지가 많으면(수십~100장) 다운로드+압축+LLM 분석이 오래 걸린다. Pro 상한까지 허용.
export const maxDuration = 800;

const HOSPITAL_BUCKET = 'case-image'; // hospital-ui 업로드 버킷
const CASE_IMAGES_BUCKET = 'chart-case-images'; // 분류 결과 저장 버킷

// POST /api/admin/runs/[runId]/case-images/from-hospital
// 병원(hospital-ui)이 제출한 이미지를 기존 분류 파이프라인(analyzeCaseImages)에 태워
// chart_pdf.parse_run_case_images 에 분류 결과와 함께 저장한다. 멱등(이미 분류돼 있으면 스킵).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  // 서버-투-서버(추출 워커) 호출은 service role key 로 인증, 그 외는 admin 세션.
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const isService = serviceKey.length > 0 && request.headers.get('authorization') === `Bearer ${serviceKey}`;
  if (!isService) {
    const gate = await requireAdminApi();
    if (!gate.ok) return gate.response;
  }

  const { runId } = await params;
  const pool = getAdminWebPgPool();
  const supabase = createServiceRoleClient();

  try {
    // 테이블/누락 컬럼(content_hash)/grant self-heal — 일반 업로드 라우트와 동일.
    // 이게 없으면 content_hash 누락 DB 에서 아래 INSERT 가 전량 실패한다.
    await ensureCaseImagesTable(pool);

    // 병원 제출 이미지 경로 조회: 진료케이스(blog_case) 또는 건강검진(hospital_notes)의 payload.image_paths.
    // (멱등/완전성 판단에 총 개수가 필요하므로 먼저 조회한다.)
    const { data: notesRows } = await supabase
      .schema('health_report')
      .from('generated_run_content')
      .select('content_type, payload')
      .eq('parse_run_id', runId)
      .in('content_type', ['blog_case', 'hospital_notes']);
    let imagePaths: string[] = [];
    let rawGroups: { date?: unknown; paths?: unknown }[] = [];
    for (const row of notesRows ?? []) {
      const pl = (row as { payload?: { image_paths?: unknown; image_groups?: unknown } }).payload;
      const paths = Array.isArray(pl?.image_paths)
        ? (pl!.image_paths as unknown[]).filter((p): p is string => typeof p === 'string' && p.length > 0)
        : [];
      if (paths.length > 0) {
        imagePaths = paths;
        rawGroups = Array.isArray(pl?.image_groups)
          ? (pl!.image_groups as { date?: unknown; paths?: unknown }[])
          : [];
        break;
      }
    }
    if (imagePaths.length === 0) {
      return NextResponse.json({ ok: true, count: 0, reason: 'no_hospital_images' });
    }

    // 멱등/자가복구: 전량 분류돼 있으면 스킵. 부분만 있으면(이전 타임아웃 등) 정리 후 전량 재분류.
    const { rows: existing } = await pool.query<{ n: string }>(
      'SELECT COUNT(*)::text AS n FROM chart_pdf.parse_run_case_images WHERE parse_run_id = $1::uuid',
      [runId],
    );
    const existingCount = Number(existing[0]?.n ?? '0');
    if (existingCount >= imagePaths.length) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'already_complete', count: existingCount });
    }
    if (existingCount > 0) {
      const { rows: oldRows } = await pool.query<{ storage_path: string }>(
        'SELECT storage_path FROM chart_pdf.parse_run_case_images WHERE parse_run_id = $1::uuid',
        [runId],
      );
      if (oldRows.length > 0) {
        await supabase.storage.from(CASE_IMAGES_BUCKET).remove(oldRows.map((r) => r.storage_path));
      }
      await pool.query('DELETE FROM chart_pdf.parse_run_case_images WHERE parse_run_id = $1::uuid', [runId]);
      await pool.query('DELETE FROM chart_pdf.parse_run_case_image_summaries WHERE parse_run_id = $1::uuid', [runId]);
    }

    // 날짜 그룹 구성: image_groups 있으면 그걸로, 없으면 전체를 날짜 없는 단일 그룹으로.
    type Group = { date: string | null; paths: string[] };
    let groups: Group[] = rawGroups
      .map((g) => ({
        date: typeof g?.date === 'string' && g.date.trim() ? g.date.trim() : null,
        paths: Array.isArray(g?.paths)
          ? (g.paths as unknown[]).filter((p): p is string => typeof p === 'string' && p.length > 0)
          : [],
      }))
      .filter((g) => g.paths.length > 0);
    if (groups.length === 0) {
      groups = [{ date: null, paths: imagePaths }];
    }

    // 그룹별로 다운로드 → 압축 → (그 날짜로) 분석 → 업로드 + insert. idx 는 전역 연속.
    let globalIdx = 0;
    let savedCount = 0;
    for (const group of groups) {
      type Downloaded = { rawBuffer: Buffer; fileName: string; hash: string };
      const downloadedRaw = await Promise.all(
        group.paths.map(async (path): Promise<Downloaded | null> => {
          const { data: blob, error } = await supabase.storage.from(HOSPITAL_BUCKET).download(path);
          if (error || !blob) return null;
          const rawBuffer = Buffer.from(await blob.arrayBuffer());
          const hash = createHash('sha256').update(rawBuffer).digest('hex');
          return { rawBuffer, fileName: path.split('/').pop() || 'image', hash };
        }),
      );
      const downloaded = downloadedRaw.filter((d): d is Downloaded => d !== null);
      if (downloaded.length === 0) continue;

      const imageParts: (ImageInputPart & { hash: string })[] = await Promise.all(
        downloaded.map(async ({ rawBuffer, fileName, hash }) => {
          const c = await prepareImageForAnalysis(rawBuffer);
          return { buffer: c.buffer, fileName, mimeType: c.mimeType, hash };
        }),
      );
      const analysis = await analyzeImageGroup({ examDate: group.date ?? '', images: imageParts });

      for (let i = 0; i < imageParts.length; i++) {
        const img = imageParts[i];
        const ext = img.mimeType === 'image/png' ? 'png' : img.mimeType === 'image/webp' ? 'webp' : 'jpg';
        const safe = (img.fileName.replace(/\.[^.]+$/, '') || 'image').replace(/[^a-zA-Z0-9._-]/g, '_');
        const storagePath = `${runId}/${globalIdx}_${safe}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from(CASE_IMAGES_BUCKET)
          .upload(storagePath, img.buffer, { contentType: img.mimeType, upsert: true });
        if (upErr) {
          globalIdx++;
          continue;
        }

        const r = analysis.images[i];
        await pool.query(
          `INSERT INTO chart_pdf.parse_run_case_images
            (parse_run_id, idx, file_name, storage_path, exam_type, radiology_sub, body_part, content_hash, exam_date)
           VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            runId, globalIdx, img.fileName, storagePath,
            r?.examType ?? 'other', r?.radiologySub ?? null, r?.bodyPart ?? '', img.hash, group.date,
          ],
        );
        globalIdx++;
        savedCount++;
      }

      // 그룹 시사점(불렛 + 뒷받침 파일명) 저장
      if (analysis.bullets.length > 0) {
        await pool.query(
          `INSERT INTO chart_pdf.parse_run_case_image_summaries (parse_run_id, exam_date, bullets)
           VALUES ($1::uuid, $2, $3::jsonb)`,
          [runId, group.date, JSON.stringify(analysis.bullets)],
        );
      }
    }

    if (savedCount === 0) {
      return NextResponse.json({ ok: true, count: 0, reason: 'download_failed' });
    }
    return NextResponse.json({ ok: true, count: savedCount });
  } catch (e) {
    console.error('POST case-images/from-hospital:', e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
