import { NextRequest, NextResponse } from 'next/server';
import { chartAppAuthMiddleware } from '@/lib/chart-app/auth';
import { loadRunDetail, listRecentRuns, listHospitalRuns } from '@/lib/chart-app/history-service';
import { isParseRunUuid } from '@/lib/chart-app/uuid';
import { getChartPgPool } from '@/lib/db';

// GET /api/history — 목록 또는 ?runId= 단건
export async function GET(request: NextRequest) {
  const authErr = chartAppAuthMiddleware(request);
  if (authErr) return authErr;

  const url = new URL(request.url);
  const runId = url.searchParams.get('runId')?.trim();
  const hospitalId = url.searchParams.get('hospitalId')?.trim();

  try {
    const pool = getChartPgPool();

    if (runId) {
      if (!isParseRunUuid(runId)) {
        return NextResponse.json({ error: 'Invalid runId' }, { status: 400 });
      }
      const includeRaw =
        process.env.CHART_APP_DEBUG_RAW_PAYLOAD === '1' ||
        process.env.CHART_APP_DEBUG_RAW_PAYLOAD === 'true';
      const client = await pool.connect();
      try {
        const detail = await loadRunDetail(client, runId, includeRaw);
        if (!detail) {
          return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
        return NextResponse.json(detail);
      } finally {
        client.release();
      }
    }

    const client = await pool.connect();
    try {
      const items = hospitalId
        ? await listHospitalRuns(client, hospitalId, 50)
        : await listRecentRuns(client, 50);
      return NextResponse.json({ items });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('GET /api/history:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
