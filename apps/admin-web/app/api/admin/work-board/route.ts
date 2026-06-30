import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { listWorkBoardItems, type WorkItem } from '@/lib/work-board';

// GET /api/admin/work-board — 잔여(pending)·완료(done) 작업 항목.
//  pending: stage !== 'done' (요청 오래된 순) / done: stage === 'done' (완료 최신순)
export async function GET() {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  try {
    const items = await listWorkBoardItems();
    const pending = items
      .filter((i) => i.stage !== 'done')
      .sort((a, b) => (a.requestedAt || '').localeCompare(b.requestedAt || '')); // 오래된 요청부터
    const done = items
      .filter((i) => i.stage === 'done')
      .sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || '')); // 최근 완료부터
    return NextResponse.json({ pending, done });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `work-board load failed: ${message}`, pending: [] as WorkItem[], done: [] as WorkItem[] }, { status: 500 });
  }
}
