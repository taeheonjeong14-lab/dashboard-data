import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

export const dynamic = 'force-dynamic';

// GET /api/notifications — 내 알림 목록(최근 30) + 안읽음 수
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ notifications: [], unread: 0 });
  const srvc = createServiceRoleClient();
  const [listRes, countRes] = await Promise.all([
    srvc.schema('core').from('notifications').select('id, type, title, body, link, read, created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(30),
    srvc.schema('core').from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('read', false),
  ]);
  if (listRes.error) return NextResponse.json({ error: listRes.error.message }, { status: 500 });
  return NextResponse.json({ notifications: listRes.data ?? [], unread: countRes.count ?? 0 });
}

// POST /api/notifications/read 대신 동일 라우트 POST 로 읽음 처리. body { id? } — id 있으면 그것만, 없으면 전체.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  let body: { id?: string } = {};
  try { body = (await request.json()) as { id?: string }; } catch { /* empty */ }
  const srvc = createServiceRoleClient();
  let q = srvc.schema('core').from('notifications').update({ read: true }).eq('user_id', user.id).eq('read', false);
  if (body.id) q = q.eq('id', body.id);
  const { error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
