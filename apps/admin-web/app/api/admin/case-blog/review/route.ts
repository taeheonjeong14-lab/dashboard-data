import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { getChartApiProxyConfig } from '@/lib/chart-api-proxy-env';
import { formatChartApiFetchError } from '@/lib/chart-api-fetch-error';
import { fetchNaverPost } from '@/lib/blog-review/naver-fetch';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * 블로그 글 검수 — chart-api `POST /api/content/blog-review` 로 서버 프록시.
 * 내부(위저드): runId + 3단계 검수본(outline/causalFlow/caseOverview) 그대로 전달.
 * 외부(admin): sourceUrl(네이버 링크)이면 서버에서 본문을 가져와 채운 뒤 전달. 실패 시 붙여넣기 안내.
 * 로컬 `.env`에 CHART_API_BASE_URL, CHART_APP_API_KEY 필요.
 */
export async function POST(request: NextRequest) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const cfg = getChartApiProxyConfig();
  if (!cfg) {
    return NextResponse.json(
      { error: 'Chart API 프록시가 설정되지 않았습니다. CHART_API_BASE_URL 과 CHART_APP_API_KEY 를 확인하세요.' },
      { status: 503 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const sourceType = body.sourceType === 'external' ? 'external' : 'internal';
  const payload: Record<string, unknown> = { ...body, sourceType, createdBy: gate.userId };

  // 외부 + 네이버 링크 + 본문 미입력 → 서버에서 본문을 가져와 채운다.
  if (sourceType === 'external') {
    const url = String(body.sourceUrl ?? body.url ?? '').trim();
    const hasBody = String(body.bodyText ?? '').trim().length > 0;
    if (url && !hasBody) {
      try {
        const post = await fetchNaverPost(url);
        payload.title = body.title || post.title;
        payload.bodyText = post.bodyText;
        payload.imageCount = post.imageCount;
        payload.sourceUrl = post.sourceUrl;
      } catch (e) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : '네이버 본문을 가져오지 못했습니다. 본문을 직접 붙여넣어 주세요.', needsPaste: true },
          { status: 422 },
        );
      }
    }
  }

  const url = `${cfg.outboundBase}/api/content/blog-review`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      return NextResponse.json(
        { error: `chart-api 응답이 JSON이 아닙니다 (${res.status})`, raw: text.slice(0, 500) },
        { status: 502 },
      );
    }
    return NextResponse.json(json, { status: res.status });
  } catch (e) {
    console.error('POST /api/admin/case-blog/review (proxy):', e);
    return NextResponse.json({ error: formatChartApiFetchError(e) }, { status: 502 });
  }
}
