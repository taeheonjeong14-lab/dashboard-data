import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { getChartApiProxyConfig } from '@/lib/chart-api-proxy-env';

export const dynamic = 'force-dynamic';

/** chart-api `/api/content/health-checkup/draft-diff/list` 프록시 — 프롬프트 개선 화면 목록. */
export async function GET(request: NextRequest) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const cfg = getChartApiProxyConfig();
  if (!cfg) return NextResponse.json({ error: 'chart-api 프록시 설정이 필요합니다.' }, { status: 503 });

  const limit = request.nextUrl.searchParams.get('limit')?.trim() || '50';

  try {
    const res = await fetch(
      `${cfg.outboundBase}/api/content/health-checkup/draft-diff/list?limit=${encodeURIComponent(limit)}`,
      { headers: { Authorization: `Bearer ${cfg.key}` } },
    );
    const json = (await res.json()) as unknown;
    return NextResponse.json(json, { status: res.status });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'chart-api 호출 실패' }, { status: 502 });
  }
}

/**
 * 실패한 분석 재시도 프록시 — chart-api `/api/content/health-checkup/draft-diff` 에 action:'retry'.
 * 자동 재시도를 두지 않은 이유는 chart-api 쪽 헬퍼 주석 참고(원인이 계정/설정이면 몇 번을 돌려도 실패한다).
 */
export async function POST(request: NextRequest) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const cfg = getChartApiProxyConfig();
  if (!cfg) return NextResponse.json({ error: 'chart-api 프록시 설정이 필요합니다.' }, { status: 503 });

  let body: { runId?: string };
  try {
    body = (await request.json()) as { runId?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const runId = String(body.runId ?? '').trim();
  if (!runId) return NextResponse.json({ error: 'runId 가 필요합니다.' }, { status: 400 });

  try {
    const res = await fetch(`${cfg.outboundBase}/api/content/health-checkup/draft-diff`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId, action: 'retry' }),
    });
    const json = (await res.json()) as unknown;
    return NextResponse.json(json, { status: res.status });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'chart-api 호출 실패' }, { status: 502 });
  }
}
