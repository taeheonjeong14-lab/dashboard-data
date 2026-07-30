import { NextRequest, NextResponse } from 'next/server';
import {
  fetchMetaAdsConversions,
  fetchMetaAdsDaily,
  fetchMetaAdsStatus,
} from '@/lib/admin-stats/queries-server';
import { requireAdminAndHospital, statsRouteError } from '@/app/api/admin/stats/_utils';

export const dynamic = 'force-dynamic';

/** Meta(인스타그램) 광고 일별 성과 + 전환 — 병원 데이터의 인스타그램 광고 탭용. */
export async function GET(request: NextRequest) {
  const gate = await requireAdminAndHospital(request);
  if (!gate.ok) return gate.response;
  try {
    // 두 테이블을 한 응답으로 내려 화면이 같은 기간 필터를 클라이언트에서 걸 수 있게 한다.
    const [rows, conversions, status] = await Promise.all([
      fetchMetaAdsDaily(gate.hospitalId),
      fetchMetaAdsConversions(gate.hospitalId),
      fetchMetaAdsStatus(gate.hospitalId),
    ]);
    return NextResponse.json({ hospitalId: gate.hospitalId, rows, conversions, status });
  } catch (e) {
    console.error('GET /api/admin/stats/meta-ads:', e);
    return NextResponse.json({ error: statsRouteError(e) }, { status: 500 });
  }
}
