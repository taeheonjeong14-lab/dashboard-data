import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

export const dynamic = 'force-dynamic';

const DEFAULT_TAGLINE_1 = '환자를 내 아이처럼';
const DEFAULT_TAGLINE_2 = '최고의 진료로 보답하겠습니다';

async function getMasterHospitalId(): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.schema('core').from('users').select('hospital_id, hospital_role').eq('id', user.id).single();
  const my = data as { hospital_id?: string | null; hospital_role?: string | null } | null;
  if (!my?.hospital_id || my.hospital_role !== 'master') return null;
  return my.hospital_id;
}

// GET — 온보딩 프리필용 현재 병원 값
export async function GET() {
  const hospitalId = await getMasterHospitalId();
  if (!hospitalId) return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
  const srvc = createServiceRoleClient();
  const { data, error } = await srvc.schema('core').from('hospitals')
    .select('name, name_en, chart_type, vet_count, tagline_line1, tagline_line2, brandColor, logoUrl, onboarding_done, wish_keywords, wish_competitors')
    .eq('id', hospitalId).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ hospital: data });
}

// POST — 온보딩 저장 + 완료 처리
export async function POST(request: NextRequest) {
  const hospitalId = await getMasterHospitalId();
  if (!hospitalId) return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });

  let b: Record<string, unknown> = {};
  try { b = (await request.json()) as Record<string, unknown>; } catch { /* empty */ }

  const cap15 = (v: unknown) => String(v ?? '').trim().slice(0, 15);
  const arr = (v: unknown) => Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 5) : [];
  const vetCount = b.vet_count === '' || b.vet_count == null ? null : Number(b.vet_count) || null;

  const patch: Record<string, unknown> = {
    name_en: String(b.name_en ?? '').trim() || null,
    chart_type: String(b.chart_type ?? '').trim() || null,
    vet_count: vetCount,
    tagline_line1: cap15(b.tagline_line1) || DEFAULT_TAGLINE_1,
    tagline_line2: cap15(b.tagline_line2) || DEFAULT_TAGLINE_2,
    brandColor: String(b.brandColor ?? '').trim() || null,
    wish_keywords: arr(b.wishKeywords),
    wish_competitors: arr(b.wishCompetitors),
    onboarding_done: true,
    updatedAt: new Date().toISOString(),
  };

  const srvc = createServiceRoleClient();
  const { error } = await srvc.schema('core').from('hospitals').update(patch).eq('id', hospitalId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
