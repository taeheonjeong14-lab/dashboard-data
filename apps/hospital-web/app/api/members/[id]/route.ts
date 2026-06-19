import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

export const dynamic = 'force-dynamic';

// POST /api/members/[id] { action: 'approve'|'reject'|'remove' } — Master 가 스태프를 처리
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const { id } = await params;

  let body: { action?: string };
  try { body = (await request.json()) as { action?: string }; } catch { body = {}; }
  const action = ['approve', 'reject', 'remove'].includes(body.action ?? '') ? body.action : '';
  if (!action) return NextResponse.json({ error: 'action 은 approve|reject|remove' }, { status: 400 });

  const { data: me } = await supabase
    .schema('core').from('users').select('hospital_id, hospital_role').eq('id', user.id).single();
  const my = me as { hospital_id?: string | null; hospital_role?: string | null } | null;
  if (!my?.hospital_id || my.hospital_role !== 'master') {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
  }
  if (id === user.id) return NextResponse.json({ error: '본인 계정은 변경할 수 없습니다.' }, { status: 400 });

  const srvc = createServiceRoleClient();
  const { data: target } = await srvc
    .schema('core').from('users').select('hospital_id, hospital_role').eq('id', id).single();
  const t = target as { hospital_id?: string | null; hospital_role?: string | null } | null;
  if (!t || t.hospital_id !== my.hospital_id) return NextResponse.json({ error: '대상을 찾을 수 없습니다.' }, { status: 404 });
  if (t.hospital_role === 'master') return NextResponse.json({ error: 'Master 계정은 변경할 수 없습니다.' }, { status: 400 });

  const patch =
    action === 'approve' ? { staff_approved: true, approved: true, rejected: false }
    : action === 'reject' ? { staff_approved: false, rejected: true, approved: false }
    : { deletedAt: new Date().toISOString(), active: false }; // remove(이탈) → DI 해제

  const { error } = await srvc.schema('core').from('users').update(patch).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
