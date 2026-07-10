import { NextRequest, NextResponse } from 'next/server';
import { withErrorLog } from '@/lib/with-error-log';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BUCKET = process.env.SUPABASE_HOSPITAL_ASSETS_BUCKET?.trim() || 'hospital-assets';

// POST (multipart: file) — 마스터가 온보딩에서 병원 로고 업로드 → hospital-assets(공개) → logoUrl 갱신
export const POST = withErrorLog({ route: '/api/onboarding/logo', feature: '온보딩 로고 업로드' }, handlePOST);

async function handlePOST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const { data: me } = await supabase.schema('core').from('users').select('hospital_id, hospital_role').eq('id', user.id).single();
  const my = me as { hospital_id?: string | null; hospital_role?: string | null } | null;
  if (!my?.hospital_id || my.hospital_role !== 'master') return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });

  const form = await request.formData();
  const f = form.get('file');
  if (!(f instanceof File)) return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 });
  const ext = (f.name.split('.').pop() || 'png').toLowerCase();

  try {
    const srvc = createServiceRoleClient();
    const objectPath = `${my.hospital_id}/logo.${ext}`;
    const bytes = Buffer.from(await f.arrayBuffer());
    const up = await srvc.storage.from(BUCKET).upload(objectPath, bytes, { contentType: f.type || 'image/png', upsert: true });
    if (up.error) throw up.error;
    const url = srvc.storage.from(BUCKET).getPublicUrl(objectPath).data.publicUrl;
    const { error } = await srvc.schema('core').from('hospitals').update({ logoUrl: url, updatedAt: new Date().toISOString() }).eq('id', my.hospital_id);
    if (error) throw error;
    return NextResponse.json({ ok: true, url });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
}
