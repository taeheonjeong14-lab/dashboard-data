// 알리고(Aligo) 카카오 알림톡 발송 헬퍼.
// 자격증명은 env 로만 받는다(코드/커밋에 박지 않음): ALIGO_API_KEY, ALIGO_USER_ID,
// ALIGO_SENDER_KEY(발신프로필키), ALIGO_SENDER(발신번호). ALIGO_TEST_MODE=Y 면 실제 발송 안 함.

const ALIGO_ALIMTALK_URL = 'https://kakaoapi.aligo.in/akv10/alimtalk/send/';

/** 숫자만 남긴 수신번호(01012345678). 유효하지 않으면 빈 문자열. */
export function normalizePhone(raw: string): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  // 국가코드 82 → 0 으로 정규화(8210... → 010...)
  const local = digits.startsWith('82') ? '0' + digits.slice(2) : digits;
  return /^01[0-9]{8,9}$/.test(local) ? local : '';
}

export type AligoButton = { name: string; linkMo: string; linkPc?: string };

export type AligoAlimtalkResult = { ok: boolean; code: number; message: string; raw: unknown };

export async function sendAligoAlimtalk(params: {
  receiver: string; // 정규화된 수신번호
  templateCode: string;
  message: string; // 승인된 템플릿 본문에 변수 치환한 전체 텍스트(정확히 일치해야 발송됨)
  subject?: string;
  button?: AligoButton; // 웹링크 버튼(템플릿에 등록돼 있어야 함)
}): Promise<AligoAlimtalkResult> {
  const apikey = process.env.ALIGO_API_KEY;
  const userid = process.env.ALIGO_USER_ID;
  const senderkey = process.env.ALIGO_SENDER_KEY;
  const sender = process.env.ALIGO_SENDER;
  if (!apikey || !userid || !senderkey || !sender) {
    throw new Error('ALIGO_* 환경변수(API_KEY/USER_ID/SENDER_KEY/SENDER)가 설정되지 않았습니다.');
  }

  const form = new URLSearchParams();
  form.set('apikey', apikey);
  form.set('userid', userid);
  form.set('senderkey', senderkey);
  form.set('tpl_code', params.templateCode);
  form.set('sender', sender);
  form.set('receiver_1', params.receiver);
  form.set('subject_1', params.subject || '건강검진 결과 리포트');
  form.set('message_1', params.message);
  if (params.button) {
    form.set(
      'button_1',
      JSON.stringify({
        button: [
          {
            name: params.button.name,
            linkType: 'WL',
            linkTypeName: '웹링크',
            linkMo: params.button.linkMo,
            linkPc: params.button.linkPc || params.button.linkMo,
          },
        ],
      }),
    );
  }
  if ((process.env.ALIGO_TEST_MODE || '').toLowerCase() === 'y') form.set('testMode', 'Y');

  const res = await fetch(ALIGO_ALIMTALK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const raw = (await res.json().catch(() => ({}))) as { code?: unknown; message?: unknown };
  const code = Number(raw?.code);
  return { ok: code === 0, code: Number.isFinite(code) ? code : -1, message: String(raw?.message ?? ''), raw };
}
