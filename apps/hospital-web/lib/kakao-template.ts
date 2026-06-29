import type { SupabaseClient } from '@supabase/supabase-js';

// 병원별 카카오 채널/템플릿 해석 + 변수 치환.
// 병원에 active 채널+템플릿이 있으면 그 발신프로필/본문으로, 없으면 null(호출부가 회사 기본 채널로 폴백).

export type ResolvedKakao = {
  templateCode: string;
  message: string;
  emphasisTitle: string | null;
  buttons: unknown[] | null;
  senderKey: string;
  senderPhone: string;
};

// 본문/제목/버튼링크의 #{변수} 자리를 치환한다. 매핑에 없는 변수는 그대로 둔다(템플릿 불일치를 눈에 띄게).
export function renderVars(text: string, vars: Record<string, string>): string {
  return text.replace(/#\{([^}]+)\}/g, (_m, key: string) => (key in vars ? vars[key] : `#{${key}}`));
}

// 버튼 배열의 linkMo/linkPc 에 변수 치환 적용.
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
 * 채널/템플릿이 없거나 비활성이면 null → 호출부가 회사 기본 채널로 폴백한다.
 */
export async function resolveHospitalKakao(
  srvc: SupabaseClient,
  hospitalId: string,
  messageType: 'survey' | 'report',
  vars: Record<string, string>,
): Promise<ResolvedKakao | null> {
  const { data: ch } = await srvc
    .schema('health_report')
    .from('hospital_kakao_channel')
    .select('sender_key, sender_phone, active')
    .eq('hospital_id', hospitalId)
    .maybeSingle();
  if (!ch || ch.active === false || !ch.sender_key || !ch.sender_phone) return null;

  const { data: tpl } = await srvc
    .schema('health_report')
    .from('hospital_kakao_template')
    .select('template_code, body, emphasis_title, buttons, active')
    .eq('hospital_id', hospitalId)
    .eq('message_type', messageType)
    .maybeSingle();
  if (!tpl || tpl.active === false || !tpl.template_code || !tpl.body) return null;

  return {
    templateCode: tpl.template_code,
    message: renderVars(tpl.body, vars),
    emphasisTitle: tpl.emphasis_title ? renderVars(tpl.emphasis_title, vars) : null,
    buttons: renderButtons(tpl.buttons, vars),
    senderKey: ch.sender_key,
    senderPhone: ch.sender_phone,
  };
}
