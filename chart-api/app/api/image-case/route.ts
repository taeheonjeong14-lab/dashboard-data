import { NextRequest, NextResponse } from 'next/server';
import { chartAppAuthMiddleware } from '@/lib/chart-app/auth';
import { getCaseImageBucket } from '@/lib/chart-app/storage-config';
import { getChartAppSupabaseService } from '@/lib/chart-app/supabase-service';
import { isParseRunUuid } from '@/lib/chart-app/uuid';
import { getChartPgPool } from '@/lib/db';
/** 서명 미리보기 TTL (초) — 스펙 예시 7일 */
const PREVIEW_TTL_SEC = 60 * 60 * 24 * 7;

type ImageRow = {
  id: string;
  exam_date: Date | string;
  file_name: string;
  exam_type: string;
  radiology_sub: string | null;
  brief_comment: string;
  has_notable_finding: boolean;
  storage_path: string;
  finding_spots: unknown;
  finding_confidence: string | null;
  related_assessment_condition: string | null;
};

function formatExamDate(d: Date | string): string {
  if (typeof d === 'string') {
    return d.length >= 10 ? d.slice(0, 10) : d;
  }
  return d.toISOString().slice(0, 10);
}

// GET /api/image-case?runId=
export async function GET(request: NextRequest) {
  const authErr = chartAppAuthMiddleware(request);
  if (authErr) return authErr;

  const runId = new URL(request.url).searchParams.get('runId')?.trim();
  if (!runId || !isParseRunUuid(runId)) {
    return NextResponse.json({ error: 'runId query parameter must be a valid UUID' }, { status: 400 });
  }

  try {
    const pool = getChartPgPool();
    const { rows } = await pool.query<ImageRow>(
      `
      SELECT
        id,
        exam_date,
        file_name,
        exam_type,
        radiology_sub,
        brief_comment,
        has_notable_finding,
        storage_path,
        finding_spots,
        finding_confidence,
        related_assessment_condition
      FROM chart_pdf.report_case_images
      WHERE parse_run_id = $1::uuid
      ORDER BY exam_date ASC, created_at ASC
      `,
      [runId],
    );

    const supabase = getChartAppSupabaseService();

    const images = await Promise.all(
      rows.map(async (row) => {
        const { data, error } = await supabase.storage
          .from(getCaseImageBucket())
          .createSignedUrl(row.storage_path, PREVIEW_TTL_SEC);

        const previewUrl = error || !data?.signedUrl ? null : data.signedUrl;

        const isClearFinding =
          row.finding_confidence === 'clear' ||
          (!row.has_notable_finding && row.finding_confidence == null);

        return {
          id: row.id,
          examDate: formatExamDate(row.exam_date),
          fileName: row.file_name,
          examType: row.exam_type,
          radiologySub: row.radiology_sub ?? undefined,
          briefComment: row.brief_comment,
          hasNotableFinding: row.has_notable_finding,
          isClearFinding,
          findingSpots: row.finding_spots ?? undefined,
          relatedAssessmentCondition: row.related_assessment_condition ?? undefined,
          storagePath: row.storage_path,
          previewUrl,
        };
      }),
    );

    return NextResponse.json({ runId, images });
  } catch (e) {
    console.error('GET /api/image-case:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

// DELETE /api/image-case?runId=&imageId=
export async function DELETE(request: NextRequest) {
  const authErr = chartAppAuthMiddleware(request);
  if (authErr) return authErr;

  const url = new URL(request.url);
  const runId = url.searchParams.get('runId')?.trim();
  const imageId = url.searchParams.get('imageId')?.trim();
  if (!runId || !isParseRunUuid(runId)) {
    return NextResponse.json({ error: 'runId required' }, { status: 400 });
  }

  try {
    const pool = getChartPgPool();
    const supabase = getChartAppSupabaseService();

    if (imageId) {
      const { rows } = await pool.query<{ storage_path: string }>(
        `SELECT storage_path FROM chart_pdf.report_case_images WHERE id = $1::uuid AND parse_run_id = $2::uuid`,
        [imageId, runId],
      );
      if (rows.length === 0) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      await supabase.storage.from(getCaseImageBucket()).remove([rows[0].storage_path]);
      await pool.query(`DELETE FROM chart_pdf.report_case_images WHERE id = $1::uuid`, [imageId]);
    } else {
      const { rows } = await pool.query<{ storage_path: string }>(
        `SELECT storage_path FROM chart_pdf.report_case_images WHERE parse_run_id = $1::uuid`,
        [runId],
      );
      const paths = rows.map((r) => r.storage_path).filter(Boolean);
      if (paths.length > 0) {
        await supabase.storage.from(getCaseImageBucket()).remove(paths);
      }
      await pool.query(`DELETE FROM chart_pdf.report_case_images WHERE parse_run_id = $1::uuid`, [runId]);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('DELETE /api/image-case:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
