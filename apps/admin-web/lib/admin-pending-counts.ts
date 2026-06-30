import { getAdminWebPgPool } from '@/lib/db';

export type AdminPendingCounts = {
  reportRequested: number;  // 건강검진: 추출됐지만 리포트 미생성(요청)
  caseRequested: number;    // 진료케이스: 추출됐지만 작성 시작 전(요청)
  caseInProgress: number;   // 진료케이스: 작성 중(미확정)
  caseDrafted: number;      // 진료케이스: 작성완료(확정)됐지만 네이버 저장완료 전(저장 대기)
  registrations: number;    // 심사 대기 병원 등록 신청
  tokenOrders: number;      // 토큰 충전: 입금 확인 대기 주문
};

async function count(sql: string): Promise<number> {
  const pool = getAdminWebPgPool();
  try {
    const { rows } = await pool.query<{ n: string }>(sql);
    return Number(rows[0]?.n ?? 0) || 0;
  } catch (e) {
    if ((e as { code?: string }).code === '42P01') return 0; // 테이블 없음 → 0
    throw e;
  }
}

// 진료케이스 "작성 콘텐츠" 단계 — 이 중 하나라도 있으면 작성 시작된 것.
const CASE_WRITE_TYPES = `'blog_causal','blog_detail','blog_outline','blog_post'`;

/**
 * 운영자 "할 일" 대기 카운트. 모두 추출 완료(extract_jobs.status='done') 기준.
 * - 건강검진 요청: 최종 리포트(health_checkup) 미생성.
 * - 진료케이스 요청: 작성 콘텐츠가 아직 하나도 없음(차트 목록에서 작업 시작).
 * - 진료케이스 작업 중: 작성 콘텐츠는 있으나 blog_post.confirmed=true(완료) 아님.
 * - 병원 심사: core.hospital_registrations status='pending'.
 */
export async function getAdminPendingCounts(): Promise<AdminPendingCounts> {
  const [reportRequested, caseRequested, caseInProgress, caseDrafted, registrations, tokenOrders] = await Promise.all([
    count(`
      SELECT count(DISTINCT j.run_id) AS n
      FROM health_report.extract_jobs j
      WHERE j.kind = 'hospital_notes' AND j.status = 'done' AND j.run_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM health_report.generated_run_content g
          WHERE g.parse_run_id = j.run_id AND g.content_type = 'health_checkup'
        )`),
    count(`
      SELECT count(DISTINCT j.run_id) AS n
      FROM health_report.extract_jobs j
      WHERE j.kind = 'blog_case' AND j.status = 'done' AND j.run_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM health_report.generated_run_content g
          WHERE g.parse_run_id = j.run_id AND g.content_type IN (${CASE_WRITE_TYPES})
        )`),
    count(`
      SELECT count(DISTINCT j.run_id) AS n
      FROM health_report.extract_jobs j
      WHERE j.kind = 'blog_case' AND j.status = 'done' AND j.run_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM health_report.generated_run_content g
          WHERE g.parse_run_id = j.run_id AND g.content_type IN (${CASE_WRITE_TYPES})
        )
        AND NOT EXISTS (
          SELECT 1 FROM health_report.generated_run_content g
          WHERE g.parse_run_id = j.run_id AND g.content_type = 'blog_post'
            AND g.payload->>'confirmed' = 'true'
        )`),
    count(`
      SELECT count(DISTINCT g.parse_run_id) AS n
      FROM health_report.generated_run_content g
      WHERE g.content_type = 'blog_post'
        AND g.payload->>'confirmed' = 'true'
        AND coalesce(g.payload->>'saved', '') <> 'true'`),
    count(`SELECT count(*) AS n FROM core.hospital_registrations WHERE status = 'pending'`),
    count(`SELECT count(*) AS n FROM billing.token_orders WHERE status = 'pending'`),
  ]);
  return { reportRequested, caseRequested, caseInProgress, caseDrafted, registrations, tokenOrders };
}
