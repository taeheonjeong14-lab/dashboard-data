import { getCaseImageBucket } from '@/lib/chart-extraction/storage-config';
import { getAdminWebPgPool } from '@/lib/db';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

/**
 * chart-api history-service.deleteRunCascade 와 동일 순서.
 * documents 삭제 시 parse_runs FK ON DELETE CASCADE 로 실행 행이 정리됩니다.
 */
export async function deleteParseRunCascade(runId: string): Promise<boolean> {
  const pool = getAdminWebPgPool();
  const client = await pool.connect();
  let pathsToRemove: string[] = [];
  try {
    await client.query('BEGIN');

    const run = await client.query<{ document_id: string }>(
      `SELECT document_id FROM chart_pdf.parse_runs WHERE id = $1::uuid LIMIT 1`,
      [runId],
    );
    if (run.rows.length === 0) {
      await client.query('ROLLBACK');
      return false;
    }
    const documentId = run.rows[0].document_id;

    try {
      const imgsChart = await client.query<{ storage_path: string }>(
        `SELECT storage_path FROM chart_pdf.report_case_images WHERE parse_run_id = $1::uuid`,
        [runId],
      );
      pathsToRemove = imgsChart.rows.map((r) => r.storage_path).filter(Boolean) as string[];
    } catch {
      pathsToRemove = [];
    }

    const { rows: pubExists } = await client.query<{ ex: boolean }>(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'report_case_images'
      ) AS ex`,
    );
    if (pubExists[0]?.ex) {
      const imgsPub = await client.query<{ storage_path: string }>(
        `SELECT storage_path FROM public.report_case_images WHERE parse_run_id = $1::uuid`,
        [runId],
      );
      pathsToRemove = [...pathsToRemove, ...imgsPub.rows.map((r) => r.storage_path).filter(Boolean)];
      await client.query(`DELETE FROM public.report_case_images WHERE parse_run_id = $1::uuid`, [runId]);
    }

    await client.query(`DELETE FROM health_report.generated_run_content WHERE parse_run_id = $1::uuid`, [runId]);
    await client.query(`DELETE FROM health_report.health_review_share_links WHERE parse_run_id = $1::uuid`, [runId]);
    // extract_jobs 는 run_id FK 가 없어 documents CASCADE 로 안 지워진다 → 명시 삭제(안 하면 삭제된 run 의
    // 잡이 고아로 남아 admin 홈 '할 일' 카운트에 유령으로 잡힌다).
    await client.query(`DELETE FROM health_report.extract_jobs WHERE run_id = $1::uuid`, [runId]);

    await client.query(`DELETE FROM chart_pdf.documents WHERE id = $1::uuid`, [documentId]);

    await client.query('COMMIT');
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }

  if (pathsToRemove.length > 0) {
    try {
      const supabase = createServiceRoleClient();
      await supabase.storage.from(getCaseImageBucket()).remove(pathsToRemove);
    } catch (e) {
      console.warn('deleteParseRunCascade: storage remove failed (non-fatal):', e);
    }
  }

  return true;
}
