import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { isParseRunUuid } from '@/lib/chart-extraction/uuid';

export const dynamic = 'force-dynamic';

// POST { runId } — 진료케이스(blog_post)를 '저장완료'로 표시한다(네이버 임시저장 확인 후).
// blog_post.payload 에 saved=true, savedAt=now 를 머지(기존 본문·확정 플래그 보존).
export async function POST(request: NextRequest) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  let body: { runId?: string };
  try {
    body = (await request.json()) as { runId?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const runId = String(body.runId ?? '').trim();
  if (!isParseRunUuid(runId)) return NextResponse.json({ error: 'runId invalid' }, { status: 400 });

  try {
    const sb = createServiceRoleClient();
    const { data: existing, error: selErr } = await sb
      .schema('health_report')
      .from('generated_run_content')
      .select('payload')
      .eq('parse_run_id', runId)
      .eq('content_type', 'blog_post')
      .maybeSingle();
    if (selErr) throw new Error(selErr.message);
    if (!existing) return NextResponse.json({ error: '확정된 진료케이스 글이 없습니다.' }, { status: 404 });

    const prev = ((existing as { payload?: Record<string, unknown> }).payload ?? {}) as Record<string, unknown>;
    if (prev.confirmed !== true) {
      return NextResponse.json({ error: '아직 작성 확정되지 않은 글입니다.' }, { status: 409 });
    }
    const merged = { ...prev, saved: true, savedAt: new Date().toISOString() };

    const { error: upErr } = await sb
      .schema('health_report')
      .from('generated_run_content')
      .update({ payload: merged, updated_at: new Date().toISOString() })
      .eq('parse_run_id', runId)
      .eq('content_type', 'blog_post');
    if (upErr) throw new Error(upErr.message);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('POST /api/admin/case-blog/mark-saved:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
}
