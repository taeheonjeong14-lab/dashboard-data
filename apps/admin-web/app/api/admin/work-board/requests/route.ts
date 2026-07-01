import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { isParseRunUuid } from '@/lib/chart-extraction/uuid';

export const dynamic = 'force-dynamic';

const BOARDS = new Set(['blog_write', 'blog_save']);

type Row = {
  id: string; run_id: string; board: string;
  requester: string | null; due_date: string | null; keyword: string | null;
  sort_order: number; created_at: string;
};
function toDto(r: Row) {
  return {
    id: r.id, runId: r.run_id, board: r.board,
    requester: r.requester ?? '', dueDate: r.due_date ?? null, keyword: r.keyword ?? '',
    sortOrder: Number(r.sort_order) || 0, createdAt: r.created_at,
  };
}

// GET — 작업 목록(의뢰) 전체. board 별로 sort_order 오름차순.
export async function GET() {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;
  try {
    const sb = createServiceRoleClient();
    const { data, error } = await sb
      .schema('health_report')
      .from('work_requests')
      .select('id, run_id, board, requester, due_date, keyword, sort_order, created_at')
      .order('board', { ascending: true })
      .order('sort_order', { ascending: true });
    if (error) throw new Error(error.message);
    return NextResponse.json({ requests: (data ?? []).map((r) => toDto(r as Row)) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error', requests: [] }, { status: 500 });
  }
}

// POST { runIds: string[] (또는 runId), board, requester?, dueDate? }
//  — 팀장이 여러 건을 한 번에 보드 작업 목록에 배정. 같은 created_at(요청일시) 으로 묶인다.
export async function POST(request: NextRequest) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  let body: { runId?: string; runIds?: unknown; board?: string; requester?: string; dueDate?: string | null; keywords?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const board = String(body.board ?? '').trim();
  if (!BOARDS.has(board)) return NextResponse.json({ error: 'board invalid' }, { status: 400 });
  const rawIds = Array.isArray(body.runIds) ? body.runIds : body.runId != null ? [body.runId] : [];
  const runIds = [...new Set(rawIds.map((x) => String(x).trim()).filter((x) => isParseRunUuid(x)))];
  if (runIds.length === 0) return NextResponse.json({ error: '배정할 항목이 없습니다.' }, { status: 400 });
  // 요청자·마감일은 필수.
  const requester = typeof body.requester === 'string' && body.requester.trim() ? body.requester.trim() : null;
  if (!requester) return NextResponse.json({ error: '요청자를 입력하세요.' }, { status: 400 });
  const dueDate = typeof body.dueDate === 'string' && body.dueDate.trim() ? body.dueDate.trim() : null;
  if (!dueDate) return NextResponse.json({ error: '마감일을 입력하세요.' }, { status: 400 });
  // 케이스별 키워드 { [runId]: keyword } — 블로그 저장(blog_save) 배정에서만 사용.
  const keywordByRun: Record<string, string> = {};
  if (board === 'blog_save' && body.keywords && typeof body.keywords === 'object' && !Array.isArray(body.keywords)) {
    for (const [k, v] of Object.entries(body.keywords as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim()) keywordByRun[k] = v.trim();
    }
  }

  try {
    const sb = createServiceRoleClient();
    // 이미 배정된 건 제외(같은 보드 유니크) — 중복 선택돼도 조용히 건너뜀.
    const { data: existing } = await sb
      .schema('health_report')
      .from('work_requests')
      .select('run_id')
      .eq('board', board)
      .in('run_id', runIds);
    const already = new Set((existing ?? []).map((r) => String((r as { run_id?: unknown }).run_id ?? '')));
    const fresh = runIds.filter((id) => !already.has(id));
    if (fresh.length === 0) return NextResponse.json({ requests: [], skipped: runIds.length });

    // blog_save 는 새로 배정하는 케이스마다 키워드 필수.
    if (board === 'blog_save') {
      const missing = fresh.filter((id) => !keywordByRun[id]);
      if (missing.length > 0) return NextResponse.json({ error: `키워드가 없는 항목이 ${missing.length}건 있습니다. 모든 케이스에 키워드를 입력하세요.` }, { status: 400 });
    }

    const createdAt = new Date().toISOString();
    const rows = fresh.map((id, i) => ({
      run_id: id, board, requester, due_date: dueDate, keyword: keywordByRun[id] ?? null,
      sort_order: i, created_at: createdAt, created_by: gate.userId,
    }));
    const { data, error } = await sb
      .schema('health_report')
      .from('work_requests')
      .insert(rows)
      .select('id, run_id, board, requester, due_date, keyword, sort_order, created_at');
    if (error) throw new Error(error.message);
    return NextResponse.json({ requests: (data ?? []).map((r) => toDto(r as Row)), skipped: runIds.length - fresh.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
}
