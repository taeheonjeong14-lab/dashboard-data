import { NextResponse, type NextRequest } from 'next/server';
import { chartAppAuthMiddleware } from '@/lib/chart-app/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/debug/blog-review-models  (Authorization: Bearer CHART_APP_API_KEY)
 * AI Gateway 가 지원하는 모델 슬러그를 조회해, 블로그 검수에 쓸 정확한 이름을 확인하는 진단 라우트.
 * AI_GATEWAY_API_KEY 하나로 Claude·Grok·Gemini 를 모두 부르므로, 여기서 각 provider 의 실제 슬러그를 골라
 * BLOG_REVIEW_MODELS 에 넣으면 된다. (배포 전 슬러그 확인용 — 실제 검수 호출은 하지 않음)
 */
export async function GET(request: NextRequest) {
  const authErr = chartAppAuthMiddleware(request);
  if (authErr) return authErr;

  const base = process.env.AI_GATEWAY_BASE_URL?.trim() || 'https://ai-gateway.vercel.sh/v1';
  const key = process.env.AI_GATEWAY_API_KEY?.trim();
  if (!key) {
    return NextResponse.json({ error: 'AI_GATEWAY_API_KEY is not configured' }, { status: 503 });
  }

  const configured = (process.env.BLOG_REVIEW_MODELS?.trim() ||
    'anthropic/claude-haiku-4.5,xai/grok-4.1-fast-reasoning,google/gemini-2.5-flash')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const aggregator = process.env.BLOG_REVIEW_AGGREGATOR_MODEL?.trim() || 'anthropic/claude-haiku-4.5';

  try {
    const res = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: 'no-store',
    });
    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json({ error: `gateway ${res.status}`, raw: text.slice(0, 500) }, { status: 502 });
    }
    const data = JSON.parse(text) as { data?: Array<{ id?: string }> };
    const ids = (data.data ?? []).map((m) => String(m.id ?? '')).filter(Boolean).sort();
    const pick = (kw: RegExp) => ids.filter((id) => kw.test(id));

    return NextResponse.json({
      base,
      total: ids.length,
      // 우리 검수용으로 자주 쓸 provider 별 후보(정확한 슬러그를 여기서 골라 env 에 넣는다).
      candidates: {
        anthropic: pick(/claude/i),
        xai: pick(/grok/i),
        google: pick(/gemini/i),
      },
      configured: {
        reviewers: configured.map((m) => ({ model: m, available: ids.includes(m) })),
        aggregator: { model: aggregator, available: ids.includes(aggregator) },
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
