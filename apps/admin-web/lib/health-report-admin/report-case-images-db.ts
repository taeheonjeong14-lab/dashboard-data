import type { Pool } from 'pg';
import type { SupabaseClient } from '@supabase/supabase-js';

/** DB row shape for GET /api/image-case style listing (snake_case). */
export type ReportCaseImageRow = {
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

const LIST_SQL_CHART_PDF = `
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
`;

const LIST_SQL_PUBLIC_FULL = `
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
  FROM public.report_case_images
  WHERE parse_run_id = $1::uuid
  ORDER BY exam_date ASC, created_at ASC
`;

const LIST_SQL_PUBLIC_MIN = `
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
    NULL::text AS related_assessment_condition
  FROM public.report_case_images
  WHERE parse_run_id = $1::uuid
  ORDER BY exam_date ASC, created_at ASC
`;

async function publicReportCaseImagesExists(pool: Pool): Promise<boolean> {
  const { rows } = await pool.query<{ ex: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'report_case_images'
    ) AS ex`,
  );
  return Boolean(rows[0]?.ex);
}

const LIST_SQL_PUBLIC_CORE = `
  SELECT
    id,
    exam_date,
    file_name,
    exam_type,
    radiology_sub,
    brief_comment,
    has_notable_finding,
    storage_path,
    NULL::jsonb AS finding_spots,
    NULL::text AS finding_confidence,
    NULL::text AS related_assessment_condition
  FROM public.report_case_images
  WHERE parse_run_id = $1::uuid
  ORDER BY exam_date ASC, created_at ASC
`;

async function queryPublicImages(pool: Pool, runId: string): Promise<ReportCaseImageRow[]> {
  if (!(await publicReportCaseImagesExists(pool))) return [];
  try {
    const { rows } = await pool.query<ReportCaseImageRow>(LIST_SQL_PUBLIC_FULL, [runId]);
    return rows;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/related_assessment_condition|finding_spots|finding_confidence|column .* does not exist/i.test(msg)) {
      throw e;
    }
    try {
      const { rows } = await pool.query<ReportCaseImageRow>(LIST_SQL_PUBLIC_MIN, [runId]);
      return rows;
    } catch (e2) {
      const msg2 = e2 instanceof Error ? e2.message : String(e2);
      if (!/column .* does not exist/i.test(msg2)) throw e2;
      const { rows } = await pool.query<ReportCaseImageRow>(LIST_SQL_PUBLIC_CORE, [runId]);
      return rows;
    }
  }
}

/**
 * vet-report는 `public.report_case_images`, 이 레포 마이그레이션은 `chart_pdf.report_case_images`.
 * chart_pdf에 행이 없으면 public을 보조 조회합니다.
 */
export async function loadReportCaseImageRows(pool: Pool, runId: string): Promise<ReportCaseImageRow[]> {
  try {
    const { rows } = await pool.query<ReportCaseImageRow>(LIST_SQL_CHART_PDF, [runId]);
    if (rows.length > 0) return rows;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/relation .*chart_pdf\.report_case_images.* does not exist/i.test(msg)) {
      console.warn('[report-case-images] chart_pdf.report_case_images missing, trying public only');
    } else {
      throw e;
    }
  }

  const pub = await queryPublicImages(pool, runId);
  if (pub.length > 0) {
    console.info('[report-case-images] loaded from public.report_case_images', { runId, count: pub.length });
  }
  return pub;
}

const SB_SELECT_FULL =
  'id, exam_date, file_name, exam_type, radiology_sub, brief_comment, has_notable_finding, storage_path, finding_spots, finding_confidence, related_assessment_condition';

const SB_SELECT_PUBLIC_MIN =
  'id, exam_date, file_name, exam_type, radiology_sub, brief_comment, has_notable_finding, storage_path, finding_spots, finding_confidence';

const SB_SELECT_PUBLIC_CORE =
  'id, exam_date, file_name, exam_type, radiology_sub, brief_comment, has_notable_finding, storage_path';

function reportCaseImageRowFromSupabaseRecord(raw: Record<string, unknown>): ReportCaseImageRow {
  return {
    id: String(raw.id ?? ''),
    exam_date: (raw.exam_date ?? '') as Date | string,
    file_name: String(raw.file_name ?? ''),
    exam_type: String(raw.exam_type ?? ''),
    radiology_sub: raw.radiology_sub != null ? String(raw.radiology_sub) : null,
    brief_comment: String(raw.brief_comment ?? ''),
    has_notable_finding: Boolean(raw.has_notable_finding),
    storage_path: String(raw.storage_path ?? ''),
    finding_spots: raw.finding_spots ?? null,
    finding_confidence: raw.finding_confidence != null ? String(raw.finding_confidence) : null,
    related_assessment_condition:
      raw.related_assessment_condition != null ? String(raw.related_assessment_condition) : null,
  };
}

function isMissingColumnOrRelationSupabase(msg: string): boolean {
  return /related_assessment_condition|finding_spots|finding_confidence|column|does not exist|schema cache/i.test(
    msg,
  );
}

async function supabaseListReportCaseImagesOrdered(
  sb: SupabaseClient,
  schema: 'chart_pdf' | 'public',
  runId: string,
  select: string,
): Promise<{ rows: ReportCaseImageRow[]; error: { message: string } | null }> {
  const { data, error } = await sb
    .schema(schema)
    .from('report_case_images')
    .select(select)
    .eq('parse_run_id', runId)
    .order('exam_date', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) return { rows: [], error: { message: error.message } };
  const list = (data ?? []) as unknown as Record<string, unknown>[];
  return { rows: list.map(reportCaseImageRowFromSupabaseRecord), error: null };
}

async function loadPublicReportCaseImageRowsSupabase(sb: SupabaseClient, runId: string): Promise<ReportCaseImageRow[]> {
  let { rows, error } = await supabaseListReportCaseImagesOrdered(sb, 'public', runId, SB_SELECT_FULL);
  if (!error && rows.length > 0) return rows;
  if (error && !isMissingColumnOrRelationSupabase(error.message)) {
    throw new Error(error.message);
  }
  if (error && /does not exist|schema cache|Could not find the table/i.test(error.message)) {
    return [];
  }

  ({ rows, error } = await supabaseListReportCaseImagesOrdered(sb, 'public', runId, SB_SELECT_PUBLIC_MIN));
  if (!error && rows.length > 0) return rows;
  if (error && !isMissingColumnOrRelationSupabase(error.message)) {
    throw new Error(error.message);
  }

  ({ rows, error } = await supabaseListReportCaseImagesOrdered(sb, 'public', runId, SB_SELECT_PUBLIC_CORE));
  if (error) {
    if (/does not exist|schema cache|Could not find the table/i.test(error.message)) return [];
    throw new Error(error.message);
  }
  return rows;
}

/**
 * `loadReportCaseImageRows` 와 동일한 우선순위(chart_pdf → public)이지만 PostgREST만 사용합니다.
 * admin-web 에서 `DATABASE_URL` 없이 동작할 때 GET/DELETE image-case 가 실패하지 않도록 합니다.
 */
export async function loadReportCaseImageRowsFromSupabase(
  sb: SupabaseClient,
  runId: string,
): Promise<ReportCaseImageRow[]> {
  const chart = await supabaseListReportCaseImagesOrdered(sb, 'chart_pdf', runId, SB_SELECT_FULL);
  if (chart.error) {
    const msg = chart.error.message;
    if (/does not exist|schema cache|Could not find the table|relation/i.test(msg)) {
      console.warn('[report-case-images] chart_pdf.report_case_images unavailable via Supabase, trying public');
    } else {
      throw new Error(msg);
    }
  } else if (chart.rows.length > 0) {
    return chart.rows;
  }

  const pub = await loadPublicReportCaseImageRowsSupabase(sb, runId);
  if (pub.length > 0) {
    console.info('[report-case-images] loaded from public.report_case_images (Supabase)', { runId, count: pub.length });
    return pub;
  }

  const parsed = await loadParseRunCaseImageRowsFromSupabase(sb, runId);
  if (parsed.length > 0) {
    console.info('[report-case-images] loaded from chart_pdf.parse_run_case_images (Supabase)', { runId, count: parsed.length });
  }
  return parsed;
}

export async function findStoragePathForImageFromSupabase(
  sb: SupabaseClient,
  runId: string,
  imageId: string,
): Promise<string | null> {
  const chart = await sb
    .schema('chart_pdf')
    .from('report_case_images')
    .select('storage_path')
    .eq('id', imageId)
    .eq('parse_run_id', runId)
    .maybeSingle();
  if (!chart.error && chart.data?.storage_path) return String(chart.data.storage_path);
  const pub = await sb
    .schema('public')
    .from('report_case_images')
    .select('storage_path')
    .eq('id', imageId)
    .eq('parse_run_id', runId)
    .maybeSingle();
  if (pub.error && /does not exist|Could not find the table/i.test(pub.error.message)) return null;
  if (pub.error) throw new Error(pub.error.message);
  return pub.data?.storage_path ? String(pub.data.storage_path) : null;
}

export async function deleteImageRowFromSupabase(
  sb: SupabaseClient,
  runId: string,
  imageId: string,
): Promise<'chart_pdf' | 'public' | null> {
  const chart = await sb
    .schema('chart_pdf')
    .from('report_case_images')
    .delete()
    .eq('id', imageId)
    .eq('parse_run_id', runId)
    .select('id');
  if (!chart.error && chart.data && chart.data.length > 0) return 'chart_pdf';

  const pub = await sb
    .schema('public')
    .from('report_case_images')
    .delete()
    .eq('id', imageId)
    .eq('parse_run_id', runId)
    .select('id');
  if (pub.error && /does not exist|Could not find the table/i.test(pub.error.message)) return null;
  if (pub.error) throw new Error(pub.error.message);
  return pub.data && pub.data.length > 0 ? 'public' : null;
}

export async function listStoragePathsForRunFromSupabase(sb: SupabaseClient, runId: string): Promise<string[]> {
  const paths = new Set<string>();
  const chart = await sb
    .schema('chart_pdf')
    .from('report_case_images')
    .select('storage_path')
    .eq('parse_run_id', runId);
  if (!chart.error && chart.data) {
    for (const r of chart.data) {
      const p = (r as { storage_path?: string }).storage_path;
      if (p) paths.add(p);
    }
  }
  const pub = await sb
    .schema('public')
    .from('report_case_images')
    .select('storage_path')
    .eq('parse_run_id', runId);
  if (pub.error && !/does not exist|Could not find the table/i.test(pub.error.message)) {
    throw new Error(pub.error.message);
  }
  if (!pub.error && pub.data) {
    for (const r of pub.data) {
      const p = (r as { storage_path?: string }).storage_path;
      if (p) paths.add(p);
    }
  }
  return [...paths];
}

export async function deleteAllImageRowsForRunFromSupabase(sb: SupabaseClient, runId: string): Promise<void> {
  const chart = await sb.schema('chart_pdf').from('report_case_images').delete().eq('parse_run_id', runId);
  if (chart.error && !/does not exist|Could not find the table/i.test(chart.error.message)) {
    throw new Error(chart.error.message);
  }
  const pub = await sb.schema('public').from('report_case_images').delete().eq('parse_run_id', runId);
  if (pub.error && !/does not exist|Could not find the table/i.test(pub.error.message)) {
    throw new Error(pub.error.message);
  }
}

export async function findStoragePathForImage(pool: Pool, runId: string, imageId: string): Promise<string | null> {
  try {
    const { rows } = await pool.query<{ storage_path: string }>(
      `SELECT storage_path FROM chart_pdf.report_case_images WHERE id = $1::uuid AND parse_run_id = $2::uuid`,
      [imageId, runId],
    );
    if (rows[0]?.storage_path) return rows[0].storage_path;
  } catch {
    /* chart_pdf 없음 */
  }
  if (!(await publicReportCaseImagesExists(pool))) return null;
  const { rows } = await pool.query<{ storage_path: string }>(
    `SELECT storage_path FROM public.report_case_images WHERE id = $1::uuid AND parse_run_id = $2::uuid`,
    [imageId, runId],
  );
  return rows[0]?.storage_path ?? null;
}

export async function deleteImageRow(pool: Pool, runId: string, imageId: string): Promise<'chart_pdf' | 'public' | null> {
  let chartDeleted = 0;
  try {
    const r = await pool.query(`DELETE FROM chart_pdf.report_case_images WHERE id = $1::uuid AND parse_run_id = $2::uuid`, [
      imageId,
      runId,
    ]);
    chartDeleted = r.rowCount ?? 0;
  } catch {
    chartDeleted = 0;
  }
  if (chartDeleted > 0) return 'chart_pdf';

  if (!(await publicReportCaseImagesExists(pool))) return null;
  const r2 = await pool.query(`DELETE FROM public.report_case_images WHERE id = $1::uuid AND parse_run_id = $2::uuid`, [
    imageId,
    runId,
  ]);
  return r2.rowCount && r2.rowCount > 0 ? 'public' : null;
}

export async function listStoragePathsForRun(pool: Pool, runId: string): Promise<string[]> {
  const paths = new Set<string>();
  try {
    const { rows } = await pool.query<{ storage_path: string }>(
      `SELECT storage_path FROM chart_pdf.report_case_images WHERE parse_run_id = $1::uuid`,
      [runId],
    );
    for (const r of rows) {
      if (r.storage_path) paths.add(r.storage_path);
    }
  } catch {
    /* chart_pdf 없음 */
  }
  if (await publicReportCaseImagesExists(pool)) {
    const { rows } = await pool.query<{ storage_path: string }>(
      `SELECT storage_path FROM public.report_case_images WHERE parse_run_id = $1::uuid`,
      [runId],
    );
    for (const r of rows) {
      if (r.storage_path) paths.add(r.storage_path);
    }
  }
  return [...paths];
}

async function loadParseRunCaseImageRowsFromSupabase(
  sb: SupabaseClient,
  runId: string,
): Promise<ReportCaseImageRow[]> {
  const { data, error } = await sb
    .schema('chart_pdf')
    .from('parse_run_case_images')
    .select('id, created_at, file_name, exam_type, radiology_sub, brief_comment, has_notable_finding, storage_path, finding_spots, related_assessment_condition')
    .eq('parse_run_id', runId)
    .order('idx', { ascending: true });
  if (error) {
    if (/does not exist|schema cache|Could not find the table|relation/i.test(error.message)) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id ?? ''),
    exam_date: r.created_at ? String(r.created_at).slice(0, 10) : '',
    file_name: String(r.file_name ?? ''),
    exam_type: String(r.exam_type ?? ''),
    radiology_sub: r.radiology_sub != null ? String(r.radiology_sub) : null,
    brief_comment: String(r.brief_comment ?? ''),
    has_notable_finding: Boolean(r.has_notable_finding),
    storage_path: String(r.storage_path ?? ''),
    finding_spots: r.finding_spots ?? null,
    finding_confidence: null,
    related_assessment_condition: r.related_assessment_condition != null ? String(r.related_assessment_condition) : null,
  }));
}

export async function deleteAllImageRowsForRun(pool: Pool, runId: string): Promise<void> {
  try {
    await pool.query(`DELETE FROM chart_pdf.report_case_images WHERE parse_run_id = $1::uuid`, [runId]);
  } catch {
    /* ignore */
  }
  if (await publicReportCaseImagesExists(pool)) {
    await pool.query(`DELETE FROM public.report_case_images WHERE parse_run_id = $1::uuid`, [runId]);
  }
}
