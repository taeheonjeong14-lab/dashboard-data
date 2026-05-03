/**
 * 이메일 발송 (Resend 사용). RESEND_API_KEY가 없으면 발송하지 않음.
 * 발신 주소: RESEND_FROM 환경 변수 또는 기본값 onboarding@resend.dev (Resend 테스트용)
 */
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.RESEND_FROM || 'RoboVet AI <onboarding@resend.dev>';

export async function sendSignupReceivedEmail(to: string, name?: string): Promise<boolean> {
  if (!RESEND_API_KEY) return false;
  try {
    const { Resend } = await import('resend');
    const resend = new Resend(RESEND_API_KEY);
    const displayName = name?.trim() || '회원';
    const { error } = await resend.emails.send({
      from: FROM,
      to: [to],
      subject: '[RoboVet AI] 가입 신청이 접수되었습니다',
      html: `
        <p>${displayName}님, 안녕하세요.</p>
        <p>RoboVet AI 가입 신청이 접수되었습니다.</p>
        <p>관리자 승인 후 로그인하여 이용하실 수 있습니다.</p>
        <p>감사합니다.</p>
      `,
    });
    return !error;
  } catch {
    return false;
  }
}

export async function sendApprovedEmail(to: string, name?: string): Promise<boolean> {
  if (!RESEND_API_KEY) return false;
  try {
    const { Resend } = await import('resend');
    const resend = new Resend(RESEND_API_KEY);
    const displayName = name?.trim() || '회원';
    const { error } = await resend.emails.send({
      from: FROM,
      to: [to],
      subject: '[RoboVet AI] 가입이 승인되었습니다',
      html: `
        <p>${displayName}님, 안녕하세요.</p>
        <p>RoboVet AI 가입이 승인되었습니다.</p>
        <p>이제 로그인하여 서비스를 이용하실 수 있습니다.</p>
        <p>감사합니다.</p>
      `,
    });
    return !error;
  } catch {
    return false;
  }
}

/** 가입 승인 거절 시 발송. 문의 안내 포함 */
export async function sendRejectedEmail(to: string, name?: string): Promise<boolean> {
  if (!RESEND_API_KEY) return false;
  try {
    const { Resend } = await import('resend');
    const resend = new Resend(RESEND_API_KEY);
    const displayName = name?.trim() || '회원';
    const { error } = await resend.emails.send({
      from: FROM,
      to: [to],
      subject: '[RoboVet AI] 가입 신청 결과 안내',
      html: `
        <p>${displayName}님, 안녕하세요.</p>
        <p>RoboVet AI 가입 신청이 승인되지 않았습니다.</p>
        <p>문의 사항이 있으시면 cs@babanlabs.com으로 메일 부탁 드립니다.</p>
        <p>감사합니다.</p>
      `,
    });
    return !error;
  } catch {
    return false;
  }
}

/** 이메일 인증 링크 발송 (회원가입 본인 확인용). 실패 시 원인 반환. */
export async function sendVerificationEmail(to: string, verifyLink: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!RESEND_API_KEY || RESEND_API_KEY.trim() === '') {
    return { ok: false, reason: 'RESEND_API_KEY가 설정되지 않았습니다. .env.local에 키를 넣고 서버를 재시작하세요.' };
  }
  try {
    const { Resend } = await import('resend');
    const resend = new Resend(RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
      from: FROM,
      to: [to],
      subject: '[RoboVet AI] 이메일 인증을 완료해 주세요',
      html: `
        <p>안녕하세요.</p>
        <p>가입 신청이 접수되었습니다. RoboVet AI 회원가입을 위해 아래 링크를 클릭해 이메일 인증을 완료해 주세요.</p>
        <p><a href="${verifyLink}" style="word-break:break-all;">${verifyLink}</a></p>
        <p style="color:#666;font-size:0.9em;">링크가 열리지 않으면 위 주소를 복사해 브라우저 주소창에 붙여 넣어 주세요.</p>
        <p>이 링크는 24시간 동안 유효합니다.</p>
        <p>본인이 요청한 것이 아니라면 이 메일을 무시하세요.</p>
      `,
    });
    if (error) {
      console.error('[Resend] sendVerificationEmail error:', error);
      return { ok: false, reason: error.message || 'Resend API 오류' };
    }
    return { ok: true };
  } catch (e) {
    console.error('[Resend] sendVerificationEmail exception:', e);
    return { ok: false, reason: e instanceof Error ? e.message : '이메일 발송 중 오류가 발생했습니다.' };
  }
}
