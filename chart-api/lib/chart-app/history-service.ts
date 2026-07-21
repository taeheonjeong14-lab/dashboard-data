import type pg from 'pg';
import { getCaseImageBucket } from '@/lib/chart-app/storage-config';
import { getChartAppSupabaseService } from '@/lib/chart-app/supabase-service';
import { getChartPgPool } from '@/lib/db';

export type HistoryListItem = {
  id: string;
  createdAt: string;
  friendlyId: string | null;
  /** chart_pdf.parse_runs.hospital_id (nullable uuid 문자열) */
  hospitalId: string | null;
  /** core.hospitals.name — 한글 표기명(레포 스키마상 name_ko 는 name 컬럼에 저장). 병원 매칭 실패 시 result_basic_info.hospital_name 폴백 */
  hospitalName: string | null;
  ownerName: string | null;
  patientName: string | null;
};

export async function listRecentRuns(client: pg.PoolClient, limit = 50): Promise<HistoryListItem[]> {
  const { rows } = await client.query<{
    id: string;
    created_at: Date;
    friendly_id: string | null;
    hospital_id: string | null;
    hospital_name: string | null;
    owner_name: string | null;
    patient_name: string | null;
  }>(
    `
    SELECT
      pr.id,
      pr.created_at,
      pr.friendly_id,
      pr.hospital_id::text AS hospital_id,
      COALESCE(
        NULLIF(btrim(COALESCE(h.name, h2.name)::text), ''),
        bi.hospital_name
      ) AS hospital_name,
      bi.owner_name,
      bi.patient_name
    FROM chart_pdf.parse_runs pr
    LEFT JOIN chart_pdf.result_basic_info bi ON bi.parse_run_id = pr.id
    LEFT JOIN core.hospitals h ON pr.hospital_id IS NOT NULL AND h.id::text = pr.hospital_id::text
    LEFT JOIN core.hospital_pdf_merge_map m
      ON pr.hospital_id IS NOT NULL AND h.id IS NULL AND m.source_hospital_id = pr.hospital_id
    LEFT JOIN core.hospitals h2 ON h2.id = m.core_hospital_id
    ORDER BY pr.created_at DESC
    LIMIT $1
    `,
    [limit],
  );

  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at.toISOString(),
    friendlyId: r.friendly_id,
    hospitalId: r.hospital_id,
    hospitalName: r.hospital_name,
    ownerName: r.owner_name,
    patientName: r.patient_name,
  }));
}

export type HospitalRunListItem = {
  id: string;
  createdAt: string;
  friendlyId: string | null;
  patientName: string | null;
  ownerName: string | null;
  /** null = 유효 링크 없음(미발급 또는 만료). 만료 여부는 shareExpired 로 구분 */
  shareUrl: string | null;
  expiresAt: string | null;
  /** true = 링크가 있었으나 만료됨(폐기 아님). shareUrl 은 null. */
  shareExpired: boolean;
};

export async function listHospitalRuns(
  client: pg.PoolClient,
  hospitalId: string,
  limit = 50,
): Promise<HospitalRunListItem[]> {
  const { rows } = await client.query<{
    id: string;
    created_at: Date;
    friendly_id: string | null;
    patient_name: string | null;
    owner_name: string | null;
    share_url: string | null;
    expires_at: Date | null;
    share_active: boolean | null;
  }>(
    `
    SELECT
      pr.id,
      pr.created_at,
      pr.friendly_id,
      bi.patient_name,
      bi.owner_name,
      s.share_url,
      s.expires_at,
      s.active AS share_active
    FROM chart_pdf.parse_runs pr
    LEFT JOIN chart_pdf.result_basic_info bi ON bi.parse_run_id = pr.id
    LEFT JOIN LATERAL (
      -- 폐기되지 않은 최신 링크 1건(만료 포함). 만료 여부는 active 로 구분해 hospital-ui 가 '만료' 표시.
      SELECT share_url, expires_at, (expires_at > now()) AS active
      FROM health_report.health_review_share_links
      WHERE parse_run_id = pr.id
        AND content_type IN ('health_checkup', 'health-checkup')
        AND revoked_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    ) s ON true
    WHERE pr.hospital_id = $1::uuid
      -- 진료케이스(blog_case) 전용 run 은 건강검진 목록에서 제외한다.
      -- (한 run 이 blog_case 이면서 동시에 건강검진(hospital_notes/health_checkup)이기도 하면 그대로 노출)
      AND NOT (
        EXISTS (
          SELECT 1 FROM health_report.generated_run_content g
          WHERE g.parse_run_id = pr.id AND g.content_type = 'blog_case'
        )
        AND NOT EXISTS (
          SELECT 1 FROM health_report.generated_run_content g
          WHERE g.parse_run_id = pr.id AND g.content_type IN ('hospital_notes', 'health_checkup')
        )
      )
    ORDER BY pr.created_at DESC
    LIMIT $2
    `,
    [hospitalId, limit],
  );

  return rows.map((r) => {
    const active = r.share_active === true;
    return {
      id: r.id,
      createdAt: r.created_at.toISOString(),
      friendlyId: r.friendly_id,
      patientName: r.patient_name,
      ownerName: r.owner_name,
      // 유효 링크만 URL 노출(만료 링크는 버튼으로 열지 않음).
      shareUrl: active ? r.share_url : null,
      expiresAt: r.expires_at ? r.expires_at.toISOString() : null,
      shareExpired: r.share_url != null && !active,
    };
  });
}

/** `raw_item_name` 비었을 때 `item_name` 복사 — 응답에 원문 표시용 값 항상 제공 */
function ensureLabRawItemName(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((r) => {
    const raw = r.raw_item_name;
    const item = r.item_name;
    const rawStr = raw == null ? '' : String(raw).trim();
    if (rawStr === '') {
      return { ...r, raw_item_name: item ?? raw };
    }
    return r;
  });
}

export async function loadRunDetail(client: pg.PoolClient, runId: string, includeRawPayload: boolean) {
  const run = await client.query(`SELECT * FROM chart_pdf.parse_runs WHERE id = $1::uuid LIMIT 1`, [runId]);
  if (run.rows.length === 0) return null;

  const documentId = run.rows[0].document_id as string;

  const [
    doc,
    basic,
    charts,
    labs,
    plans,
    vacc,
    vitals,
    physical,
    images,
    genContent,
    shares,
  ] = await Promise.all([
    client.query(`SELECT * FROM chart_pdf.documents WHERE id = $1::uuid LIMIT 1`, [documentId]),
    client.query(`SELECT * FROM chart_pdf.result_basic_info WHERE parse_run_id = $1::uuid LIMIT 1`, [runId]),
    client.query(
      `SELECT * FROM chart_pdf.result_chart_by_date WHERE parse_run_id = $1::uuid ORDER BY row_order NULLS LAST, created_at`,
      [runId],
    ),
    client.query(`SELECT * FROM chart_pdf.result_lab_items WHERE parse_run_id = $1::uuid ORDER BY row_order`, [
      runId,
    ]),
    client.query(`SELECT * FROM chart_pdf.result_plan_rows WHERE parse_run_id = $1::uuid ORDER BY row_order`, [
      runId,
    ]),
    client.query(`SELECT * FROM chart_pdf.result_vaccination_records WHERE parse_run_id = $1::uuid ORDER BY row_order`, [
      runId,
    ]),
    client.query(`SELECT * FROM chart_pdf.result_vitals WHERE parse_run_id = $1::uuid ORDER BY row_order`, [runId]),
    client.query(
      `SELECT * FROM chart_pdf.result_physical_exam_items WHERE parse_run_id = $1::uuid ORDER BY row_order`,
      [runId],
    ),
    client.query(`SELECT * FROM chart_pdf.report_case_images WHERE parse_run_id = $1::uuid ORDER BY exam_date`, [
      runId,
    ]),
    client.query(`SELECT * FROM health_report.generated_run_content WHERE parse_run_id = $1::uuid`, [runId]),
    client.query(`SELECT * FROM health_report.health_review_share_links WHERE parse_run_id = $1::uuid`, [runId]),
  ]);

  const pr = run.rows[0] as Record<string, unknown>;
  if (!includeRawPayload) {
    delete pr.raw_payload;
  }

  return {
    document: doc.rows[0] ?? null,
    parseRun: pr,
    basicInfo: basic.rows[0] ?? null,
    chartByDates: charts.rows,
    labItems: ensureLabRawItemName(labs.rows as Record<string, unknown>[]),
    planRows: plans.rows,
    vaccinationRecords: vacc.rows,
    vitals: vitals.rows,
    physicalExamItems: physical.rows,
    reportCaseImages: images.rows,
    generatedRunContent: genContent.rows,
    healthReviewShareLinks: shares.rows,
  };
}

export async function deleteRunCascade(runId: string): Promise<boolean> {
  const pool = getChartPgPool();
  const client = await pool.connect();
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

    const imgs = await client.query<{ storage_path: string }>(
      `SELECT storage_path FROM chart_pdf.report_case_images WHERE parse_run_id = $1::uuid`,
      [runId],
    );

    await client.query(`DELETE FROM health_report.generated_run_content WHERE parse_run_id = $1::uuid`, [runId]);
    await client.query(`DELETE FROM health_report.health_review_share_links WHERE parse_run_id = $1::uuid`, [runId]);
    // extract_jobs 는 run_id FK 가 없어 documents CASCADE 로 안 지워진다 → 명시 삭제(안 하면 삭제된 run 의
    // 잡이 고아로 남아 admin 홈 '할 일' 카운트에 유령으로 잡힌다).
    await client.query(`DELETE FROM health_report.extract_jobs WHERE run_id = $1::uuid`, [runId]);

    await client.query(`DELETE FROM chart_pdf.documents WHERE id = $1::uuid`, [documentId]);

    await client.query('COMMIT');

    const paths = imgs.rows.map((r) => r.storage_path).filter(Boolean);
    if (paths.length > 0) {
      try {
        const supabase = getChartAppSupabaseService();
        await supabase.storage.from(getCaseImageBucket()).remove(paths);
      } catch (e) {
        console.warn('deleteRunCascade: storage remove failed (non-fatal):', e);
      }
    }

    return true;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
