import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { isParseRunUuid } from '@/lib/chart-extraction/uuid';
import { getChartApiProxyConfig } from '@/lib/chart-api-proxy-env';

export const dynamic = 'force-dynamic';

/** chart-api `/api/content/health-checkup/draft-diff` 프록시 — 비교 분석 대상 선택/해제·상태 조회. */
export async function GET(request: NextRequest) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const cfg = getChartApiProxyConfig();
  if (!cfg) return NextResponse.json({ error: 'chart-api 프록시 설정이 필요합니다.' }, { status: 503 });

  const runId = request.nextUrl.searchParams.get('runId')?.trim() ?? '';
  if (!isParseRunUuid(runId)) return NextResponse.json({ error: 'runId invalid' }, { status: 400 });

  try {
    const res = await fetch(
      `${cfg.outboundBase}/api/content/health-checkup/draft-diff?runId=${encodeURIComponent(runId)}`,
      { headers: { Authorization: `Bearer ${cfg.key}` } },
    );
    const json = (await res.json()) as unknown;
    return NextResponse.json(json, { status: res.status });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'chart-api 호출 실패' }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const cfg = getChartApiProxyConfig();
  if (!cfg) return NextResponse.json({ error: 'chart-api 프록시 설정이 필요합니다.' }, { status: 503 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const runId = String(body.runId ?? '').trim();
  if (!isParseRunUuid(runId)) return NextResponse.json({ error: 'runId invalid' }, { status: 400 });

  try {
    const res = await fetch(`${cfg.outboundBase}/api/content/health-checkup/draft-diff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({ runId, selected: body.selected !== false, createdBy: gate.userId }),
    });
    const json = (await res.json()) as unknown;
    return NextResponse.json(json, { status: res.status });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'chart-api 호출 실패' }, { status: 502 });
  }
}
