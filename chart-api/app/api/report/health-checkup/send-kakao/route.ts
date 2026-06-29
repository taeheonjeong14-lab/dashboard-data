import { NextRequest, NextResponse } from 'next/server';
import { hashShareToken } from '@/lib/chart-app/share-token';
import { hospitalRowFromDb } from '@/lib/chart-app/hospital-db';
import { getHealthCheckupGeneratedContentForRun } from '@/lib/generated-run-content';
import { loadRunBasicsForPdfBasename } from '@/lib/report-source-pdf-basename';
import { buildHealthCheckupSharePrintUrlForRequest } from '@/lib/chart-app/health-checkup-export-print-url';
import { renderAndStoreReportPdf } from '@/lib/chart-app/report-pdf-store';
import { normalizePhone } from '@/lib/chart-app/aligo';
import { resolveHospitalKakao } from '@/lib/chart-app/kakao-template';
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
    // 템플릿(UI_6805)에 등록된 버튼 순서와 정확히 일치해야 함: ① 채널 추가(AC) ② 리포트 확인하기(WL).
    const buttons = [
      { type: 'AC', name: '채널 추가' },
      { type: 'WL', name: '리포트 확인하기', linkMo: pdfUrl, linkPc: pdfUrl },
    ];

    // 병원별 카카오 채널/템플릿이 설정돼 있으면 그 발신프로필·본문으로, 없으면 회사 기본 채널로 폴백.
    // 변수: #{환자명}·#{검진일}·#{병원명}·#{token}·#{reportUrl}.
    const resolved = hospitalId
      ? await resolveHospitalKakao(pool, String(hospitalId), 'report', {
          '환자명': patientName, '검진일': checkupDate, '병원명': hospitalName, token, reportUrl: pdfUrl,
        })
      : null;
    const templateCode = resolved ? resolved.templateCode : (process.env.ALIGO_TPL_CODE || 'UI_6805');
    const emphasisTitle = resolved ? resolved.emphasisTitle : `${patientName} 건강검진 리포트`;
    const message = resolved ? resolved.message : buildMessage(patientName, checkupDate, hospitalName);
    const buttonsToSend = resolved ? resolved.buttons : buttons;
    const senderKey = resolved ? resolved.senderKey : null;
    const senderPhone = resolved ? resolved.senderPhone : null;

    // 알리고는 고정 발신 IP 를 요구하나 chart-api(Vercel) egress IP 는 유동적 → 사무실 고정 IP 뒤의
    // 워커(collect-worker)가 발송하도록 outbox 에 적재한다. 워커가 꺼내 알리고로 보냄.
    // sender_key 가 있으면 워커가 그 발신프로필로, 없으면 ENV(회사 기본) 로 발송.
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO health_report.alimtalk_outbox
         (status, run_id, hospital_id, receiver, template_code, subject, emphasis_title, message, buttons, pdf_url, product_code, sender_key, sender_phone)
       VALUES ('queued', $1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::jsonb, $9, 'health_report', $10, $11)
       RETURNING id`,
      [
        runId,
        hospitalId,
        phone,
        templateCode,
        '우리아이 건강검진',
        emphasisTitle,
        message,
        JSON.stringify(buttonsToSend),
        pdfUrl,
        senderKey,
        senderPhone,
      ],
    );
    const outboxId = ins.rows[0]?.id;

    // 큐에 적재 즉시 응답(버튼 즉시 반응). 발송 결과(성공/실패)는 워커가 alimtalk_result 알림으로 전달한다.
    return NextResponse.json({ ok: true, queued: true, outboxId, message: '발송이 요청되었습니다. 곧 전송됩니다.' });
  } catch (e) {
    console.error('POST send-kakao:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : '발송 실패' }, { status: 500 });
  }
}
