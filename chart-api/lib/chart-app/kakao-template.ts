import type { Pool } from 'pg';

// 병원별 카카오 채널/템플릿 해석 + 변수 치환 (chart-api / pg 버전).
// hospital-web 의 lib/kakao-template.ts 와 동일 로직 — DB 드라이버만 다르다(이쪽은 pg pool). 한쪽 고치면 양쪽 맞출 것.

export type ResolvedKakao = {
  templateCode: string;
  message: string;
  emphasisTitle: string | null;
  buttons: unknown[] | null;
  senderKey: string;
  senderPhone: string;
};

// 본문/제목/버튼링크의 #{변수} 자리를 치환한다. 매핑에 없는 변수는 그대로 둔다.
export function renderVars(text: string, vars: Record<string, string>): string {
  return text.replace(/#\{([^}]+)\}/g, (_m, key: string) => (key in vars ? vars[key] : `#{${key}}`));
}

function renderButtons(buttons: unknown, vars: Record<string, string>): unknown[] | null {
  if (!Array.isArray(buttons)) return null;
  return buttons.map((b) => {
    if (!b || typeof b !== 'object') return b;
    const o = { ...(b as Record<string, unknown>) };
    if (typeof o.linkMo === 'string') o.linkMo = renderVars(o.linkMo, vars);
    if (typeof o.linkPc === 'string') o.linkPc = renderVars(o.linkPc, vars);
    return o;
  });
}

/**
 * 병원의 카카오 채널+템플릿을 조회해 발송 정보로 해석한다.
 * 채널/템플릿이 없거나 비활성이면 null → 호출부가 회사 기본 채널로 폴백.
 */
export async function resolveHospitalKakao(
  pool: Pool,
  hospitalId: string,
  messageType: 'survey' | 'report',
  vars: Record<string, string>,
): Promise<ResolvedKakao | null> {
  const ch = await pool.query<{ sender_key: string | null; sender_phone: string | null; active: boolean }>(
    `SELECT sender_key, sender_phone, active FROM health_report.hospital_kakao_channel WHERE hospital_id = $1 LIMIT 1`,
    [hospitalId],
  );
  const c = ch.rows[0];
  if (!c || c.active === false || !c.sender_key || !c.sender_phone) return null;

  const t = await pool.query<{ template_code: string | null; body: string | null; emphasis_title: string | null; buttons: unknown; active: boolean }>(
    `SELECT template_code, body, emphasis_title, buttons, active
     FROM health_report.hospital_kakao_template
     WHERE hospital_id = $1 AND message_type = $2 LIMIT 1`,
    [hospitalId, messageType],
  );
  const tpl = t.rows[0];
  if (!tpl || tpl.active === false || !tpl.template_code || !tpl.body) return null;

  return {
    templateCode: tpl.template_code,
    message: renderVars(tpl.body, vars),
    emphasisTitle: tpl.emphasis_title ? renderVars(tpl.emphasis_title, vars) : null,
    buttons: renderButtons(tpl.buttons, vars),
    senderKey: c.sender_key,
    senderPhone: c.sender_phone,
  };
}
