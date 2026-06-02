import type { Metadata } from 'next';
import '@fontsource/noto-sans-kr/400.css';
import '@fontsource/noto-sans-kr/500.css';
import '@fontsource/noto-sans-kr/700.css';
// 외부 검토 화면도 Pretendard 우선(스택 1순위)으로 일관 렌더 — 사용자 PC 폰트 유무와 무관하게.
import '@fontsource/pretendard/400.css';
import '@fontsource/pretendard/500.css';
import '@fontsource/pretendard/700.css';
import { getChartPgPool } from '@/lib/db';
import { hashShareToken } from '@/lib/chart-app/share-token';
import { hospitalRowFromDb } from '@/lib/chart-app/hospital-db';
import HealthCheckupShareReviewClient from './share-review-client';

const LINK_CONTENT_TYPE = 'health_checkup';
const LEGACY_LINK_CONTENT_TYPE = 'health-checkup';
const GENERATED_CONTENT_TYPE = 'health_checkup';

/**
 * 공유 링크를 채팅 등에 붙였을 때 뜨는 미리보기(Open Graph) 메타데이터.
 * 병원명 · 환자명 · 검진일자를 서버에서 토큰으로 조회해 노출한다.
 * (크롤러는 클라이언트 JS를 실행하지 않으므로 서버 렌더 meta 가 필요하다.)
 * 병원명은 리포트 표지와 동일하게 core.hospitals.name_ko → result_basic_info.hospital_name 순.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const fallback: Metadata = {
    title: '건강검진 리포트',
    robots: { index: false, follow: false },
  };
  try {
    const { token } = await params;
    if (!token) return fallback;

    const pool = getChartPgPool();
    const hash = hashShareToken(token);
    const link = await pool.query<{ parse_run_id: string; expires_at: Date; revoked_at: Date | null }>(
      `SELECT parse_run_id, expires_at, revoked_at FROM health_report.health_review_share_links WHERE token_hash = $1 AND content_type IN ($2, $3) LIMIT 1`,
      [hash, LINK_CONTENT_TYPE, LEGACY_LINK_CONTENT_TYPE],
    );
    const row = link.rows[0];
    if (!row || row.revoked_at || row.expires_at.getTime() < Date.now()) return fallback;

    const runId = row.parse_run_id;
    const trim = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

    // 표지 payload(환자명·검진일자) — 가장 중요한 소스. 이 조회가 되면 최소 환자·날짜는 노출된다.
    const gen = await pool.query<{ payload: { coverPatientName?: string; coverCheckupDate?: string } | null }>(
      `SELECT payload FROM health_report.generated_run_content WHERE parse_run_id = $1::uuid AND content_type = $2 LIMIT 1`,
      [runId, GENERATED_CONTENT_TYPE],
    );
    const payload = gen.rows[0]?.payload ?? null;

    // 추출 기본정보(병원명·환자명 보조) — 실패해도 전체 미리보기를 막지 않도록 개별 격리.
    let basicHospital = '';
    let basicPatient = '';
    let hospitalId: string | null = null;
    try {
      const rb = await pool.query<{
        hospital_id: string | null;
        basic_hospital: string | null;
        basic_patient: string | null;
      }>(
        `SELECT pr.hospital_id, b.hospital_name AS basic_hospital, b.patient_name AS basic_patient
         FROM chart_pdf.parse_runs pr
         LEFT JOIN chart_pdf.result_basic_info b ON b.parse_run_id = pr.id
         WHERE pr.id = $1::uuid LIMIT 1`,
        [runId],
      );
      hospitalId = rb.rows[0]?.hospital_id ?? null;
      basicHospital = trim(rb.rows[0]?.basic_hospital);
      basicPatient = trim(rb.rows[0]?.basic_patient);
    } catch (e) {
      console.error('[review/health-checkup] basic info lookup failed:', e);
    }

    // 등록 병원명(리포트 표지와 동일 소스). 컬럼명 차이(name_ko/name 등)·오류에도 안전하게
    // SELECT * 후 검증된 매퍼로 읽고, 실패해도 환자·날짜는 살린다.
    let hospitalNameKo = '';
    if (hospitalId) {
      try {
        const h = await pool.query(`SELECT * FROM core.hospitals WHERE id::text = $1 LIMIT 1`, [
          String(hospitalId),
        ]);
        hospitalNameKo = trim(hospitalRowFromDb(h.rows[0] ?? null)?.name_ko);
      } catch (e) {
        console.error('[review/health-checkup] hospital lookup failed:', e);
      }
    }

    const hospital = hospitalNameKo || basicHospital;
    const patient = trim(payload?.coverPatientName) || basicPatient;
    const checkupDate = trim(payload?.coverCheckupDate);

    const titleParts = [hospital, patient, checkupDate].filter(Boolean);
    const title = titleParts.length ? titleParts.join(' · ') : '건강검진 리포트';
    const descParts = [
      hospital ? `병원: ${hospital}` : '',
      patient ? `환자: ${patient}` : '',
      checkupDate ? `검진일: ${checkupDate}` : '',
    ].filter(Boolean);
    const description = descParts.length ? descParts.join(' / ') : '건강검진 리포트 검토 링크';

    return {
      title,
      description,
      robots: { index: false, follow: false },
      openGraph: { title, description, type: 'website' },
      twitter: { card: 'summary', title, description },
    };
  } catch {
    return fallback;
  }
}

export default function HealthCheckupShareReviewPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#ffffff', fontFamily: "'Noto Sans KR', sans-serif" }}>
      <HealthCheckupShareReviewClient />
    </div>
  );
}
