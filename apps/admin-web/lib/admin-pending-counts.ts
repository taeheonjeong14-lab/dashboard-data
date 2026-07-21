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
 * run 이 실제로 chart_pdf.parse_runs 에 남아 있는지 확인하는 상관 서브쿼리.
 * generated_run_content 는 원본 run 이 삭제돼도 남을 수 있으므로, 이 가드가 없으면
 * 삭제된 케이스가 "할 일" 로 유령처럼 계속 잡힌다(작업 현황판은 parse_runs 를 조인해 이미 제외 중).
 * id·parse_run_id 타입이 스키마마다 uuid/text 로 엇갈릴 수 있어 ::text 로 통일 비교한다.
 */
const RUN_EXISTS = (runCol: string) =>
  `EXISTS (SELECT 1 FROM chart_pdf.parse_runs r WHERE r.id::text = ${runCol}::text)`;

/**
 * 운영자 "할 일" 대기 카운트.
 *
 * ★ 소스는 generated_run_content(=병원 제출·작성 콘텐츠). 작업 현황판(work-board)과 반드시 같은 소스여야
 *   홈 카운트와 현황판/목록이 일치한다. 예전엔 extract_jobs(추출 잡)를 셌는데, 재추출(replace_run_id) 잡은
 *   실제 제출과 무관하게 여러 개 쌓여, 제출 콘텐츠가 없는 run 이 "요청"으로 유령처럼 잡혔다(홈엔 뜨는데
 *   눌러도 목록에 없음). 요청 판정 신호는 "제출 흔적" content_type — 검진=hospital_notes, 케이스=blog_case.
 *
 * - 건강검진 요청: hospital_notes 있고 최종 리포트(health_checkup) 미생성.
 * - 진료케이스 요청: blog_case 있고 작성 콘텐츠가 아직 하나도 없음.
 * - 진료케이스 작업 중: blog_case + 작성 콘텐츠 있으나 blog_post.confirmed=true(완료) 아님.
 * - 진료케이스 저장 대기: blog_post.confirmed=true 이나 saved 아님.
 * - 병원 심사: core.hospital_registrations status='pending'.
 * ※ run 기반 카운트는 모두 parse_runs 존재를 확인해 삭제된 케이스를 제외한다(RUN_EXISTS).
 */
export async function getAdminPendingCounts(): Promise<AdminPendingCounts> {
  const [reportRequested, caseRequested, caseInProgress, caseDrafted, registrations, tokenOrders] = await Promise.all([
    count(`
      SELECT count(DISTINCT g.parse_run_id) AS n
      FROM health_report.generated_run_content g
      WHERE g.content_type = 'hospital_notes'
        AND ${RUN_EXISTS('g.parse_run_id')}
        AND NOT EXISTS (
          SELECT 1 FROM health_report.generated_run_content g2
          WHERE g2.parse_run_id = g.parse_run_id AND g2.content_type = 'health_checkup'
        )`),
    count(`
      SELECT count(DISTINCT g.parse_run_id) AS n
      FROM health_report.generated_run_content g
      WHERE g.content_type = 'blog_case'
        AND ${RUN_EXISTS('g.parse_run_id')}
        AND NOT EXISTS (
          SELECT 1 FROM health_report.generated_run_content g2
          WHERE g2.parse_run_id = g.parse_run_id AND g2.content_type IN (${CASE_WRITE_TYPES})
        )`),
    count(`
      SELECT count(DISTINCT g.parse_run_id) AS n
      FROM health_report.generated_run_content g
      WHERE g.content_type = 'blog_case'
        AND ${RUN_EXISTS('g.parse_run_id')}
        AND EXISTS (
          SELECT 1 FROM health_report.generated_run_content g2
          WHERE g2.parse_run_id = g.parse_run_id AND g2.content_type IN (${CASE_WRITE_TYPES})
        )
        AND NOT EXISTS (
          SELECT 1 FROM health_report.generated_run_content g2
          WHERE g2.parse_run_id = g.parse_run_id AND g2.content_type = 'blog_post'
            AND g2.payload->>'confirmed' = 'true'
        )`),
    count(`
      SELECT count(DISTINCT g.parse_run_id) AS n
      FROM health_report.generated_run_content g
      WHERE g.content_type = 'blog_post'
        AND g.payload->>'confirmed' = 'true'
        AND coalesce(g.payload->>'saved', '') <> 'true'
        AND ${RUN_EXISTS('g.parse_run_id')}`),
    count(`SELECT count(*) AS n FROM core.hospital_registrations WHERE status = 'pending'`),
    count(`SELECT count(*) AS n FROM billing.token_orders WHERE status = 'pending'`),
  ]);
  return { reportRequested, caseRequested, caseInProgress, caseDrafted, registrations, tokenOrders };
}
