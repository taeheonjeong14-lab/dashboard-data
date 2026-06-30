import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PATCH { requester?, dueDate? } — 의뢰 내용(요청자·마감일) 수정.
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'id invalid' }, { status: 400 });

  let body: { requester?: string | null; dueDate?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const patch: Record<string, unknown> = {};
  if ('requester' in body) patch.requester = typeof body.requester === 'string' && body.requester.trim() ? body.requester.trim() : null;
  if ('dueDate' in body) patch.due_date = typeof body.dueDate === 'string' && body.dueDate.trim() ? body.dueDate.trim() : null;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'nothing to update' }, { status: 400 });

  try {
    const sb = createServiceRoleClient();
    const { error } = await sb.schema('health_report').from('work_requests').update(patch).eq('id', id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
}

// DELETE — 작업 목록에서 제거(다시 대기 풀로 돌아감).
export async function DELETE(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'id invalid' }, { status: 400 });
  try {
    const sb = createServiceRoleClient();
    const { error } = await sb.schema('health_report').from('work_requests').delete().eq('id', id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
}
