import { NextRequest, NextResponse } from 'next/server';
import { fetchSearchAdMetrics } from '@/lib/admin-stats/queries-server';
import { requireAdminAndHospital, statsRouteError } from '@/app/api/admin/stats/_utils';

export const dynamic = 'force-dynamic';

/** 검색광고 일별 성과(캠페인 레벨) — 병원 데이터의 파워링크·플레이스 광고 탭용. */
export async function GET(request: NextRequest) {
  const gate = await requireAdminAndHospital(request);
  if (!gate.ok) return gate.response;
  try {
    const type = request.nextUrl.searchParams.get('campaignType') || undefined;
    const rows = await fetchSearchAdMetrics(gate.hospitalId, type);
    return NextResponse.json({ hospitalId: gate.hospitalId, rows });
  } catch (e) {
    console.error('GET /api/admin/stats/searchad:', e);
    return NextResponse.json({ error: statsRouteError(e) }, { status: 500 });
  }
}
