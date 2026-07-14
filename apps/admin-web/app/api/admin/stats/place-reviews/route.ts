import { NextRequest, NextResponse } from 'next/server';
import { fetchPlaceReviewStats } from '@/lib/admin-stats/queries-server';
import { requireAdminAndHospital, statsRouteError } from '@/app/api/admin/stats/_utils';

export const dynamic = 'force-dynamic';

/** 플레이스 리뷰 통계(월별 추이 + 감성 분포 + 부정 리뷰) — hospital 대시보드와 동일. */
export async function GET(request: NextRequest) {
  const gate = await requireAdminAndHospital(request);
  if (!gate.ok) return gate.response;
  try {
    const stats = await fetchPlaceReviewStats(gate.hospitalId);
    return NextResponse.json({ hospitalId: gate.hospitalId, stats });
  } catch (e) {
    console.error('GET /api/admin/stats/place-reviews:', e);
    return NextResponse.json({ error: statsRouteError(e) }, { status: 500 });
  }
}
