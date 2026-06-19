import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

export const dynamic = 'force-dynamic';

// GET /api/members — 내 병원의 멤버 목록 (Master 전용)
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const { data: me } = await supabase
    .schema('core').from('users').select('hospital_id, hospital_role').eq('id', user.id).single();
  const my = me as { hospital_id?: string | null; hospital_role?: string | null } | null;
  if (!my?.hospital_id || my.hospital_role !== 'master') {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
  }

  const srvc = createServiceRoleClient();
  const { data, error } = await srvc
    .schema('core').from('users')
    .select('id, email, name, phone, hospital_role, staff_approved, approved, rejected, "createdAt"')
    .eq('hospital_id', my.hospital_id)
    .is('deletedAt', null)
    .order('createdAt', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ members: data ?? [], myUserId: user.id });
}
