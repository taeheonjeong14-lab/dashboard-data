import { NextRequest, NextResponse } from 'next/server';
import { fetchSearchAdTopKeywords } from '@/lib/admin-stats/queries-server';
import { requireAdminAndHospital, statsRouteError } from '@/app/api/admin/stats/_utils';

export const dynamic = 'force-dynamic';

/** Top 키워드 표 — 선택 기간의 키워드별 합산 상위 N개(DB 집계 RPC). */
export async function GET(request: NextRequest) {
  const gate = await requireAdminAndHospital(request);
  if (!gate.ok) return gate.response;
  try {
    const q = request.nextUrl.searchParams;
    const start = q.get('start') ?? '';
    const end = q.get('end') ?? '';
    if (!start || !end) return NextResponse.json({ error: 'start/end required' }, { status: 400 });
    const limit = Number(q.get('limit') ?? 10) || 10;
    const rows = await fetchSearchAdTopKeywords(gate.hospitalId, q.get('campaignType') || undefined, start, end, limit);
    return NextResponse.json({ hospitalId: gate.hospitalId, rows });
  } catch (e) {
    console.error('GET /api/admin/stats/searchad-top-keywords:', e);
    return NextResponse.json({ error: statsRouteError(e) }, { status: 500 });
  }
}
