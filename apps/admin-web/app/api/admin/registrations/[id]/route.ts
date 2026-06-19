import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

export const dynamic = 'force-dynamic';

const BUCKET = 'hospital-docs';

type Reg = {
  id: string; hospital_name: string; phone: string | null; address: string | null; address_detail: string | null;
  email: string | null; director_name: string | null; director_phone: string | null;
  biz_cert_path: string | null; vet_license_path: string | null; master_user_id: string | null;
  status: string; hospital_id: string | null;
};

// GET — 신청 1건 + 첨부파일 서명 다운로드 URL
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;
  const { id } = await params;
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.schema('core').from('hospital_registrations').select('*').eq('id', id).single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'not found' }, { status: 404 });
  const reg = data as Reg;
  const sign = async (path: string | null) => {
    if (!path) return null;
    const { data: s } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 10);
    return s?.signedUrl ?? null;
  };
  const [bizUrl, vetUrl] = await Promise.all([sign(reg.biz_cert_path), sign(reg.vet_license_path)]);
  return NextResponse.json({ registration: reg, files: { bizCertUrl: bizUrl, vetLicenseUrl: vetUrl } });
}

// POST { action: 'approve' | 'reject', note? } — 심사 처리
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;
  const { id } = await params;
  let body: { action?: string; note?: string };
  try { body = (await request.json()) as { action?: string; note?: string }; } catch { body = {}; }
  const action = body.action === 'approve' ? 'approve' : body.action === 'reject' ? 'reject' : '';
  if (!action) return NextResponse.json({ error: 'action 은 approve|reject' }, { status: 400 });

  const supabase = createServiceRoleClient();
  const { data: regRow, error: regErr } = await supabase.schema('core').from('hospital_registrations').select('*').eq('id', id).single();
  if (regErr || !regRow) return NextResponse.json({ error: regErr?.message ?? 'not found' }, { status: 404 });
  const reg = regRow as Reg;
  if (reg.status !== 'pending') return NextResponse.json({ error: '이미 처리된 신청입니다.' }, { status: 409 });

  if (action === 'reject') {
    await supabase.schema('core').from('hospital_registrations')
      .update({ status: 'rejected', review_note: body.note ?? null, reviewed_at: new Date().toISOString() }).eq('id', id);
    // 마스터 계정은 rejected 처리 → DI 해제(재신청 허용), 로그인 차단
    if (reg.master_user_id) {
      await supabase.schema('core').from('users').update({ rejected: true, approved: false }).eq('id', reg.master_user_id);
    }
    // TODO(notify): 병원 이메일 + 대표원장 휴대폰으로 거절 통지(사유 포함)
    return NextResponse.json({ ok: true, status: 'rejected' });
  }

  // approve — core.hospitals 생성 (병원은 마스터와 독립. id 는 앱에서 생성: DB 기본값 없음)
  const hospitalId = randomUUID();
  const { error: hospErr } = await supabase.schema('core').from('hospitals')
    .insert({
      id: hospitalId,
      name: reg.hospital_name,
      phone: reg.phone,
      address: reg.address,
      email: reg.email,
      director_phone: reg.director_phone,
      director_name_ko: reg.director_name,
    });
  if (hospErr) return NextResponse.json({ error: `병원 생성 실패: ${hospErr.message}` }, { status: 500 });

  // 마스터 연결·활성화 — best-effort(병원과 별개라, 마스터 처리 실패해도 병원 생성/승인은 유지)
  if (reg.master_user_id) {
    const { error: mErr } = await supabase.schema('core').from('users').update({
      hospital_id: hospitalId,
      hospital_role: 'master',
      staff_approved: true,
      approved: true,
      rejected: false,
      active: true,
    }).eq('id', reg.master_user_id);
    if (mErr) console.warn('[registrations approve] master link failed (hospital still created):', mErr.message);
  }

  await supabase.schema('core').from('hospital_registrations')
    .update({ status: 'approved', hospital_id: hospitalId, review_note: body.note ?? null, reviewed_at: new Date().toISOString() }).eq('id', id);

  // TODO(notify): 병원 이메일 + 대표원장 휴대폰으로 승인 통지(가입 안내)
  return NextResponse.json({ ok: true, status: 'approved', hospitalId });
}
