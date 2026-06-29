import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { formatSupabaseError } from '@/lib/format-supabase-error';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

// 병원별 카카오 채널/템플릿 설정 조회·저장 (admin 전용).
// 채널(발신프로필키·발신번호) + 메시지 종류별(survey/report) 템플릿(코드·본문·강조제목·버튼).

const MESSAGE_TYPES = ['survey', 'report'] as const;
type MessageType = (typeof MESSAGE_TYPES)[number];

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const { id } = await context.params;
  const hospitalId = String(id || '').trim();
  if (!hospitalId) return NextResponse.json({ error: 'id required' }, { status: 400 });

  try {
    const supabase = createServiceRoleClient();
    const [chRes, tplRes] = await Promise.all([
      supabase.schema('health_report').from('hospital_kakao_channel')
        .select('sender_key, sender_phone, active').eq('hospital_id', hospitalId).maybeSingle(),
      supabase.schema('health_report').from('hospital_kakao_template')
        .select('message_type, template_code, body, emphasis_title, buttons, active').eq('hospital_id', hospitalId),
    ]);
    if (chRes.error) throw chRes.error;
    if (tplRes.error) throw tplRes.error;

    const templates: Record<string, unknown> = {};
    for (const t of MESSAGE_TYPES) {
      templates[t] = (tplRes.data || []).find((r) => r.message_type === t) ?? null;
    }
    return NextResponse.json({ channel: chRes.data ?? null, templates });
  } catch (e) {
    return NextResponse.json({ error: formatSupabaseError(e) }, { status: 500 });
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const { id } = await context.params;
  const hospitalId = String(id || '').trim();
  if (!hospitalId) return NextResponse.json({ error: 'id required' }, { status: 400 });

  let body: { channel?: Record<string, unknown>; templates?: Record<string, Record<string, unknown> | null> };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  try {
    const supabase = createServiceRoleClient();
    const now = new Date().toISOString();

    // 채널: 발신프로필키·발신번호가 모두 있으면 upsert, 아니면 삭제(=폴백, 회사 채널 사용).
    const senderKey = String(body.channel?.sender_key ?? '').trim();
    const senderPhone = String(body.channel?.sender_phone ?? '').replace(/\D/g, '');
    if (senderKey && senderPhone) {
      const { error } = await supabase.schema('health_report').from('hospital_kakao_channel').upsert({
        hospital_id: hospitalId,
        sender_key: senderKey,
        sender_phone: senderPhone,
        active: body.channel?.active === false ? false : true,
        updated_at: now,
      }, { onConflict: 'hospital_id' });
      if (error) throw error;
    } else {
      const { error } = await supabase.schema('health_report').from('hospital_kakao_channel')
        .delete().eq('hospital_id', hospitalId);
      if (error) throw error;
    }

    // 템플릿: 종류별로 코드+본문이 있으면 upsert, 아니면 그 종류 삭제.
    for (const t of MESSAGE_TYPES) {
      const tpl = body.templates?.[t] ?? null;
      const code = String(tpl?.template_code ?? '').trim();
      const tplBody = String(tpl?.body ?? '').trim();
      if (tpl && code && tplBody) {
        const { error } = await supabase.schema('health_report').from('hospital_kakao_template').upsert({
          hospital_id: hospitalId,
          message_type: t,
          template_code: code,
          body: String(tpl.body ?? ''),
          emphasis_title: tpl.emphasis_title ? String(tpl.emphasis_title) : null,
          buttons: tpl.buttons ?? null,
          active: tpl.active === false ? false : true,
          updated_at: now,
        }, { onConflict: 'hospital_id,message_type' });
        if (error) throw error;
      } else {
        const { error } = await supabase.schema('health_report').from('hospital_kakao_template')
          .delete().eq('hospital_id', hospitalId).eq('message_type', t);
        if (error) throw error;
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: formatSupabaseError(e) }, { status: 500 });
  }
}
