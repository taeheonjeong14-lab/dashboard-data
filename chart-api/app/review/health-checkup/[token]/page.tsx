import type { Metadata } from 'next';
import '@fontsource/noto-sans-kr/400.css';
import '@fontsource/noto-sans-kr/500.css';
import '@fontsource/noto-sans-kr/700.css';
import { getChartPgPool } from '@/lib/db';
import { hashShareToken } from '@/lib/chart-app/share-token';
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
    const [runBasic, gen] = await Promise.all([
      pool.query<{ hospital_id: string | null; basic_hospital: string | null; basic_patient: string | null }>(
        `SELECT pr.hospital_id, b.hospital_name AS basic_hospital, b.patient_name AS basic_patient
         FROM chart_pdf.parse_runs pr
         LEFT JOIN chart_pdf.result_basic_info b ON b.parse_run_id = pr.id
         WHERE pr.id = $1::uuid LIMIT 1`,
        [runId],
      ),
      pool.query<{ payload: { coverPatientName?: string; coverCheckupDate?: string } | null }>(
        `SELECT payload FROM health_report.generated_run_content WHERE parse_run_id = $1::uuid AND content_type = $2 LIMIT 1`,
        [runId, GENERATED_CONTENT_TYPE],
      ),
    ]);

    const trim = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

    const hospitalId = runBasic.rows[0]?.hospital_id ?? null;
    let hospitalNameKo = '';
    if (hospitalId) {
      const h = await pool.query<{ name_ko: string | null }>(
        `SELECT name_ko FROM core.hospitals WHERE id::text = $1 LIMIT 1`,
        [String(hospitalId)],
      );
      hospitalNameKo = trim(h.rows[0]?.name_ko);
    }

    const payload = gen.rows[0]?.payload ?? null;
    const hospital = hospitalNameKo || trim(runBasic.rows[0]?.basic_hospital);
    const patient = trim(payload?.coverPatientName) || trim(runBasic.rows[0]?.basic_patient);
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
