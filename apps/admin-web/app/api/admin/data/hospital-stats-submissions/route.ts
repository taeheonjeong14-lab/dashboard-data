import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { listHospitalStatsSubmissions } from '@/lib/hospital-stats-submissions';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const raw = request.nextUrl.searchParams.get('limit');
  const limit = Math.min(200, Math.max(1, Number.parseInt(raw ?? '60', 10) || 60));

  try {
    const items = await listHospitalStatsSubmissions(limit);
    return NextResponse.json({ items });
  } catch (e) {
    console.error('GET /api/admin/data/hospital-stats-submissions:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e), items: [] }, { status: 500 });
  }
}
