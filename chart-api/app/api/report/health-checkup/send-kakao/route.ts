import { NextRequest, NextResponse } from 'next/server';
import { hashShareToken } from '@/lib/chart-app/share-token';
import { hospitalRowFromDb } from '@/lib/chart-app/hospital-db';
import { getHealthCheckupGeneratedContentForRun } from '@/lib/generated-run-content';
import { loadRunBasicsForPdfBasename } from '@/lib/report-source-pdf-basename';
import { buildHealthCheckupSharePrintUrlForRequest } from '@/lib/chart-app/health-checkup-export-print-url';
import { renderAndStoreReportPdf } from '@/lib/chart-app/report-pdf-store';
import { sendAligoAlimtalk, normalizePhone } from '@/lib/chart-app/aligo';
import { getChartPgPool } from '@/lib/db';

// POST /api/report/health-checkup/send-kakao — 보호자에게 건강검진 리포트를 카카오 알림톡으로 발송.
export const maxDuration = 120;
export const runtime = 'nodejs';

const LINK_CONTENT_TYPE = 'health_checkup';
const LEGACY_LINK_CONTENT_TYPE = 'health-checkup';

// 승인된 템플릿(UI_3996) 본문에 변수를 치환한 전체 텍스트. 템플릿과 글자까지 일치해야 발송됨.
function buildMessage(patientName: string, checkupDate: string, hospitalName: string): string {
  return [
    `안녕하세요, ${patientName} 보호자님.`,
    '',
    `${checkupDate}에 ${hospitalName}에서 진행하셨던 ${patientName}의 건강검진 결과 리포트 전달 드립니다.`,
    '',
    `궁금하신 점 있으시면 언제든지 편하게 ${hospitalName}으로 연락 주시면 친절하게 상담 드릴 수 있도록 하겠습니다.`,
    '',
    '감사합니다.',
  ].join('\n');
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const token = String(body.token ?? '').trim();
  const phone = normalizePhone(String(body.phone ?? ''));
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 });
  if (!phone) return NextResponse.json({ error: '올바른 휴대폰 번호를 입력해 주세요.' }, { status: 400 });

  try {
    const pool = getChartPgPool();
    const hash = hashShareToken(token);
    const { rows } = await pool.query<{ expires_at: Date; revoked_at: Date | null; parse_run_id: string }>(
      `SELECT expires_at, revoked_at, parse_run_id
       FROM health_report.health_review_share_links
       WHERE token_hash = $1 AND content_type IN ($2, $3)
       LIMIT 1`,
      [hash, LINK_CONTENT_TYPE, LEGACY_LINK_CONTENT_TYPE],
    );
    const row = rows[0];
    if (!row || row.revoked_at || row.expires_at.getTime() < Date.now()) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const runId = row.parse_run_id;

    // 변수 로드(환자명·검진일자·동물병원명)
    const [basics, runRes, generatedRow] = await Promise.all([
      loadRunBasicsForPdfBasename(runId),
      pool.query<{ hospital_id: string | null }>(
        `SELECT hospital_id FROM chart_pdf.parse_runs WHERE id = $1::uuid LIMIT 1`,
        [runId],
      ),
      getHealthCheckupGeneratedContentForRun(null, runId),
    ]);
    if (!generatedRow) {
      return NextResponse.json({ error: 'generated content not found' }, { status: 404 });
    }
    const payload = generatedRow.payload as { coverPatientName?: string; coverCheckupDate?: string } | null;

    let hospitalName = basics.hospitalNameFromBasic?.trim() || '';
    const hospitalId = runRes.rows[0]?.hospital_id ?? null;
    if (hospitalId) {
      const { rows: hospitals } = await pool.query(`SELECT * FROM core.hospitals WHERE id::text = $1 LIMIT 1`, [String(hospitalId)]);
      const hospitalRow = hospitalRowFromDb(hospitals[0] ?? null);
      hospitalName = hospitalRow?.name_ko?.trim() || hospitalName;
    }
    const patientName = payload?.coverPatientName?.trim() || basics.patientNameFromBasic?.trim() || '환자';
    const checkupDate =
      payload?.coverCheckupDate?.trim() ||
      (basics.runCreatedAtIso ? new Date(basics.runCreatedAtIso).toLocaleDateString('ko-KR') : '');
    hospitalName = hospitalName || '동물병원';

    // PDF 1회 렌더·저장(고객 버튼 클릭 시 즉시 서빙되도록).
    const printUrl = buildHealthCheckupSharePrintUrlForRequest(request.url, token);
    try {
      await renderAndStoreReportPdf(runId, printUrl);
    } catch (e) {
      console.error('[send-kakao] PDF 저장 실패(발송은 진행):', e);
    }

    const pdfUrl = `${new URL(request.url).origin}/review/health-checkup/${encodeURIComponent(token)}/pdf`;
    const templateCode = process.env.ALIGO_TPL_CODE || 'UI_3996';

    const result = await sendAligoAlimtalk({
      receiver: phone,
      templateCode,
      message: buildMessage(patientName, checkupDate, hospitalName),
      subject: '건강검진 결과 리포트',
      button: { name: '리포트 보러가기', linkMo: pdfUrl, linkPc: pdfUrl },
    });

    if (!result.ok) {
      // 실패 시(특히 -99 IP 인증) 이 발송 함수가 실제로 외부로 나갈 때 쓰는 공인 IP 를 같이 알려준다.
      // (디버그 라우트와 다른 함수/NAT IP 일 수 있어, 알리고에 등록할 "정확한" IP 를 화면에서 바로 확인)
      let egressIp: string | null = null;
      try {
        const j = (await (await fetch('https://api.ipify.org?format=json', { cache: 'no-store' })).json()) as { ip?: string };
        egressIp = j.ip ?? null;
      } catch { /* noop */ }
      console.error('[send-kakao] aligo 실패', result.code, result.message, result.raw, 'egressIp=', egressIp);
      const ipNote = egressIp ? ` [호출 IP: ${egressIp} — 알리고에 이 IP 등록 필요]` : '';
      return NextResponse.json({ error: `발송 실패 (${result.code}: ${result.message})${ipNote}`, egressIp }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('POST send-kakao:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : '발송 실패' }, { status: 500 });
  }
}
