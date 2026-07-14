import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { fetchOverviewRows } from '@/lib/admin-stats/overview-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** 전체 현황 보드 — 병원별 최근 4주 vs 직전 4주 변화. (병원 비교가 아니라 '봐야 할 병원' 선별용) */
export async function GET() {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;
  try {
    const rows = await fetchOverviewRows();
    return NextResponse.json({ rows });
  } catch (e) {
    console.error('GET /api/admin/stats/overview:', e);
    const msg = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : JSON.stringify(e);
    return NextResponse.json({ error: msg || '조회 실패' }, { status: 500 });
  }
}
