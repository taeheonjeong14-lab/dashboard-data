import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { countParseRunsInChartPdf, listRecentParseRuns } from '@/lib/chart-parse-runs-list';

const MAX_LIMIT = 200;

export async function GET(request: NextRequest) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const raw = request.nextUrl.searchParams.get('limit');
  const n = raw ? Number.parseInt(raw, 10) : 80;
  const limit = Number.isFinite(n) ? Math.min(Math.max(1, n), MAX_LIMIT) : 80;
  // q: friendly_id 검색어(작업 현황 '열기' 진입 등). 있으면 최근 제한과 무관하게 매칭 run 을 찾는다.
  const q = request.nextUrl.searchParams.get('q')?.trim() || undefined;

  try {
    const [totalParseRuns, items] = await Promise.all([
      countParseRunsInChartPdf(),
      listRecentParseRuns(limit, q),
    ]);
    return NextResponse.json({
      items,
      meta: { totalParseRuns, limit },
    });
  } catch (e) {
    console.error('GET /api/admin/data/parse-runs:', e);
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        error: `history list load failed: ${message}`,
        items: [] as unknown[],
      },
      { status: 500 },
    );
  }
}
