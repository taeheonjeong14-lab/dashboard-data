import { NextResponse, type NextRequest } from 'next/server';
import { chartAppAuthMiddleware } from '@/lib/chart-app/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/debug/naver-probe?url=<네이버 블로그 링크>  (Authorization: Bearer CHART_APP_API_KEY)
 * 배포 환경(네이버 접근 가능)에서 실제 마크업을 조사해, 태그·섹션(소제목) 추출 로직을 맞추는 진단용.
 */
function parseIds(raw: string): { blogId: string; logNo: string } | null {
  try {
    const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    const qb = u.searchParams.get('blogId');
    const ql = u.searchParams.get('logNo');
    if (qb && ql) return { blogId: qb, logNo: ql };
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length >= 2 && /^\d+$/.test(parts[1])) return { blogId: parts[0], logNo: parts[1] };
  } catch {
    /* noop */
  }
  return null;
}

function uniq(matches: string[]): { value: string; count: number }[] {
  const m = new Map<string, number>();
  for (const s of matches) m.set(s, (m.get(s) ?? 0) + 1);
  return [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count).slice(0, 40);
}

export async function GET(request: NextRequest) {
  const authErr = chartAppAuthMiddleware(request);
  if (authErr) return authErr;

  const raw = request.nextUrl.searchParams.get('url') ?? '';
  const ids = parseIds(raw);
  if (!ids) return NextResponse.json({ error: 'url 파싱 실패', raw }, { status: 400 });

  const mobileUrl = `https://m.blog.naver.com/${ids.blogId}/${ids.logNo}`;
  const res = await fetch(mobileUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'Accept-Language': 'ko-KR,ko;q=0.9',
    },
  });
  const html = await res.text();

  const classMatches = (kw: RegExp) => uniq((html.match(/class="[^"]*"/g) ?? []).filter((c) => kw.test(c)));

  return NextResponse.json({
    mobileUrl,
    status: res.status,
    size: html.length,
    hasSeContainer: /se-main-container/.test(html),
    hasPostViewArea: /id="postViewArea"/.test(html),
    ogTitle: html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]*)"/i)?.[1] ?? null,
    tagNameMatches: uniq((html.match(/[?&]tagName=[^&"'\\ >]+/g) ?? [])),
    hashSamples: uniq((html.match(/>\s*#\s*[^<#\s][^<]{0,30}</g) ?? [])).slice(0, 20),
    tagClasses: classMatches(/tag/i),
    headingClasses: classMatches(/(heading|title|section|subtitle|se_h|se-h)/i),
    metaKeywords: html.match(/<meta[^>]*name="keywords"[^>]*content="([^"]*)"/i)?.[1] ?? null,
  });
}
