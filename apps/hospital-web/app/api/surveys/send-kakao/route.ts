import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

// POST /api/surveys/send-kakao — 보호자에게 사전문진 작성 링크를 카카오 알림톡으로 발송.
// 건강검진 리포트 발송과 동일하게 health_report.alimtalk_outbox 에 적재만 하고, 사무실 고정 IP 워커가
// 꺼내 알리고로 보낸다(워커/과금 그대로 재사용). 사전문진은 run 이 없으므로 run_id·pdf_url 은 비운다.
export const runtime = 'nodejs';

const SURVEY_TEMPLATE_CODE = process.env.ALIGO_TPL_CODE_SURVEY || 'UI_SURVEY';
const DDX_API = (
  process.env.DDX_API_URL ||
  process.env.NEXT_PUBLIC_DDX_API_URL ||
  'https://ddx-api.vercel.app'
).replace(/\/$/, '');

/** 숫자만 남긴 수신번호(01012345678). 유효하지 않으면 빈 문자열. */
function normalizePhone(raw: string): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  const local = digits.startsWith('82') ? '0' + digits.slice(2) : digits;
  return /^01[0-9]{8,9}$/.test(local) ? local : '';
}

/** 세션 scheduledDate(ISO) → 알림톡 변수 #{예약일} 표기("6월 25일"). 없으면 빈 문자열. */
function formatVisitDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric' });
}

// 승인된 사전문진 템플릿 본문에 변수를 치환한 전체 텍스트. 템플릿과 글자까지 일치해야 발송됨.
// 변수: #{예약일}(visitDate), #{동물병원명}(hospitalName).
function buildMessage(visitDate: string, hospitalName: string): string {
  return [
    '안녕하세요, 보호자님.',
    '',
    `${visitDate} ${hospitalName} 예약이 확인되었습니다.`,
    '',
    '내원 전 아이의 상태를 미리 확인하기 위해 간단한 사전문진을 부탁드립니다.',
    '',
    '문진은 약 3분 정도 소요되며, 작성해 주신 내용을 바탕으로 저희 의료진이 보다 세심하게 진료를 준비할 수 있도록 하겠습니다.',
    '',
    '아래 링크를 통해 사전문진 작성해주세요.',
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

  // 로그인 + 병원 확인(과금 귀속 대상). hospital_id 는 클라이언트를 신뢰하지 않고 세션에서 가져온다.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const { data: profile } = await supabase
    .schema('core')
    .from('users')
    .select('hospital_id')
    .eq('id', user.id)
    .single();
  const hospitalId = (profile?.hospital_id as string | null) ?? null;
  if (!hospitalId) return NextResponse.json({ error: '병원 정보를 불러올 수 없습니다.' }, { status: 400 });

  try {
    const srvc = createServiceRoleClient();

    // 병원명(메시지 변수). 못 찾으면 '동물병원'.
    let hospitalName = '동물병원';
    const { data: hospital } = await srvc
      .schema('core')
      .from('hospitals')
      .select('name_ko')
      .eq('id', hospitalId)
      .single();
    if (hospital?.name_ko && String(hospital.name_ko).trim()) hospitalName = String(hospital.name_ko).trim();

    // 내원 예정일(#{예약일}) — 세션에 저장된 scheduledDate 를 토큰으로 조회. 알림톡 변수는 비면 발송 거부되므로 필수.
    let visitDate = '';
    try {
      const sres = await fetch(`${DDX_API}/api/survey?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
      if (sres.ok) {
        const sdata = (await sres.json()) as { session?: { scheduledDate?: string | null } };
        visitDate = formatVisitDate(sdata.session?.scheduledDate);
      }
    } catch { /* 조회 실패 → 아래에서 차단 */ }
    if (!visitDate) {
      return NextResponse.json({ error: '내원 예정일이 없어 알림톡을 보낼 수 없습니다. 사전문진에 내원 예정일을 입력해 주세요.' }, { status: 400 });
    }

    // WL 버튼 링크 — 운영 도메인(NEXT_PUBLIC_SITE_URL)을 베이스로 토큰 경로를 붙인다(템플릿 등록 도메인과 일치).
    const base = (process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin).replace(/\/$/, '');
    const surveyUrl = `${base}/survey/${encodeURIComponent(token)}`;

    // 템플릿 등록 버튼 순서와 정확히 일치해야 함: ① 채널 추가(AC) ② 사전문진 작성하기(WL).
    const buttons = [
      { type: 'AC', name: '채널 추가' },
      { type: 'WL', name: '사전문진 작성하기', linkMo: surveyUrl, linkPc: surveyUrl },
    ];

    const { data: ins, error: insErr } = await srvc
      .schema('health_report')
      .from('alimtalk_outbox')
      .insert({
        status: 'queued',
        run_id: null,
        hospital_id: hospitalId,
        receiver: phone,
        template_code: SURVEY_TEMPLATE_CODE,
        subject: '사전문진 안내',
        message: buildMessage(visitDate, hospitalName),
        buttons,
        pdf_url: null,
        product_code: 'survey',
      })
      .select('id')
      .single();
    if (insErr || !ins?.id) {
      console.error('POST surveys/send-kakao insert:', insErr);
      return NextResponse.json({ error: '발송 대기열 적재에 실패했습니다.' }, { status: 500 });
    }
    const outboxId = ins.id as string;

    // 큐에 적재 즉시 응답(버튼 즉시 반응). 발송 결과(성공/실패)는 워커가 alimtalk_result 알림으로 전달한다.
    return NextResponse.json({ ok: true, queued: true, outboxId, message: '발송이 요청되었습니다. 곧 전송됩니다.' });
  } catch (e) {
    console.error('POST surveys/send-kakao:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : '발송 실패' }, { status: 500 });
  }
}
