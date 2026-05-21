import type pg from 'pg';

// chart_pdf.parse_run_case_images 는 마이그레이션이 아니라 런타임에 보장한다(기존 패턴).
// INSERT 전에 호출해 테이블/누락 컬럼(content_hash)/grant 를 self-heal 한다.
// from-hospital 라우트가 이걸 호출하지 않아 content_hash 누락 DB 에서 INSERT 가
// "column ... does not exist" 로 전량 실패하던 문제를 막는다.
export async function ensureCaseImagesTable(pool: pg.Pool): Promise<void> {
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
  await pool.query(`
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE chart_pdf.parse_run_case_images TO service_role;
    GRANT SELECT ON TABLE chart_pdf.parse_run_case_images TO authenticated;
  `);
}
