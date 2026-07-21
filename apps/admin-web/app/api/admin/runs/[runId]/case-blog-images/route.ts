import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { getAdminWebPgPool } from '@/lib/db';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { prepareImageForAnalysis } from '@/lib/chart-case-images/encode';
import {
  analyzeCaseBlogImages,
  type ImageInputPart,
  type CaseBlogSectionInput,
} from '@/lib/chart-case-images/analyze';
import { chargeOperationTokens } from '@/lib/billing/token-charge';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const CASE_IMAGES_BUCKET = 'chart-case-images';
const UUID_RE = /^[0-9a-fA-F-]{36}$/;

// POST /api/admin/runs/[runId]/case-blog-images
// 진료케이스 4단계: 확정된 글의 섹션 + 최종진단명/맥락 + 케이스 이미지를 비전 분석해
// 섹션별 imageFileNames 배정을 돌려준다(저장은 클라이언트가 blog_outline 에).
export async function POST(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const { runId } = await params;
  if (!UUID_RE.test(runId)) {
    return NextResponse.json({ error: 'runId 형식 오류' }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const sections: CaseBlogSectionInput[] = (Array.isArray(body.sections) ? body.sections : [])
    .map((s) => {
      const o = (s ?? {}) as Record<string, unknown>;
      return {
        id: String(o.id ?? '').trim(),
        label: String(o.label ?? '').trim(),
        keyText: String(o.keyText ?? '').trim(),
      };
    })
    .filter((s) => s.id);
  const finalDiagnosis = String(body.finalDiagnosis ?? '').trim();
  const contextText = String(body.contextText ?? '').trim();
  if (sections.length === 0) {
    return NextResponse.json({ ok: true, assignments: [] });
  }

  try {
    const pool = getAdminWebPgPool();

    const { rows: prRows } = await pool.query<{ hospital_id: string | null }>(
      `SELECT hospital_id FROM chart_pdf.parse_runs WHERE id = $1::uuid LIMIT 1`,
      [runId],
    );
    const hospitalId = prRows[0]?.hospital_id ?? null;

    const { rows: biRows } = await pool.query<{ species: string | null; breed: string | null; age: number | null; sex: string | null }>(
      `SELECT species, breed, age, sex FROM chart_pdf.result_basic_info WHERE parse_run_id = $1::uuid LIMIT 1`,
      [runId],
    );
    const bi = biRows[0];
    const patient = {
      species: bi?.species ?? undefined,
      breed: bi?.breed ?? undefined,
      age: bi?.age != null ? String(bi.age) : undefined,
      sex: bi?.sex ?? undefined,
    };

    const { rows: imgRows } = await pool.query<{ file_name: string; storage_path: string; exam_date: string | null }>(
      `SELECT file_name, storage_path, exam_date::text AS exam_date FROM chart_pdf.parse_run_case_images WHERE parse_run_id = $1::uuid ORDER BY exam_date NULLS LAST, idx`,
      [runId],
    );
    if (imgRows.length === 0) {
      return NextResponse.json({ ok: true, assignments: [] });
    }

    const supabase = createServiceRoleClient();
    const images: (ImageInputPart & { examDate?: string | null })[] = [];
    for (const r of imgRows) {
      try {
        const { data: blob, error } = await supabase.storage.from(CASE_IMAGES_BUCKET).download(r.storage_path);
        if (error || !blob) continue;
        const buf = Buffer.from(await blob.arrayBuffer());
        const c = await prepareImageForAnalysis(buf);
        images.push({ buffer: c.buffer, fileName: r.file_name, mimeType: c.mimeType, examDate: r.exam_date });
      } catch {
        /* 개별 이미지 다운로드 실패는 건너뛴다 */
      }
    }
    if (images.length === 0) {
      return NextResponse.json({ ok: true, assignments: [] });
    }

    // 소프트 게이트: 블로그 이미지 배정은 '이미 시작된 작업'의 진행 단계라 잔액 게이트를 두지 않는다(잔액 검사는 추출에서만).
    const operationId = randomUUID();
    const { assignments } = await analyzeCaseBlogImages({
      patient,
      finalDiagnosis,
      contextText,
      sections,
      images,
      usageContext: { hospitalId, runId, feature: 'blog_images', operationId },
    });
    await chargeOperationTokens(hospitalId, operationId, 'blog_images');

    return NextResponse.json({ ok: true, assignments });
  } catch (e) {
    console.error('POST case-blog-images:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : '이미지 배정 실패' }, { status: 500 });
  }
}
