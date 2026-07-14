import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { fetchKeywordBoard } from '@/lib/admin-stats/keyword-board-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** 키워드 순위 보드 — 전 병원 키워드를 하락 순으로. */
export async function GET() {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;
  try {
    const rows = await fetchKeywordBoard();
    return NextResponse.json({ rows });
  } catch (e) {
    console.error('GET /api/admin/stats/keyword-board:', e);
    const msg = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : JSON.stringify(e);
    return NextResponse.json({ error: msg || '조회 실패' }, { status: 500 });
  }
}
