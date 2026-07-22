import type { NextRequest } from 'next/server';
import { logError } from '@/lib/error-log';

// 브라우저 → (동일 출처) hospital-web → ddx-api 로 전달하는 프록시 핸들러.
// ddx-api 는 CORS 헤더를 보내지 않으므로 브라우저가 직접 호출하면 cross-origin 차단됨.
// 서버-투-서버 전달은 CORS 와 무관하므로 이 프록시를 통하면 로컬/배포 모두 동작한다.
// 대상 호스트는 환경변수로 고정 — 임의 호스트로의 오픈 프록시가 아니다.
// env 값은 스킴까지 포함한 절대 URL 이어야 한다(https://ddx-api.vercel.app).
// 스킴이 빠지거나 URL 이 아닌 값이 들어가면 fetch 가 'Failed to parse URL' 로 즉사해
// 화면엔 'ddx-api 연결에 실패했습니다.' 만 뜬다. 안 넣으면 아래 기본값으로 동작한다.
const DDX_API = (
  process.env.DDX_API_URL ||
  process.env.NEXT_PUBLIC_DDX_API_URL ||
  'https://ddx-api.vercel.app'
).replace(/\/$/, '');

export async function ddxProxy(
  req: NextRequest,
  ctx: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const { path } = await ctx.params;
  const subPath = (path ?? []).join('/');
  const search = req.nextUrl.search; // '?take=200&userId=...' 포함
  const target = `${DDX_API}/${subPath}${search}`;

  const headers: Record<string, string> = {};
  const ct = req.headers.get('content-type');
  if (ct) headers['content-type'] = ct;
  const accept = req.headers.get('accept');
  if (accept) headers['accept'] = accept;

  const init: RequestInit = { method: req.method, headers, redirect: 'manual' };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const buf = await req.arrayBuffer();
    if (buf.byteLength > 0) init.body = buf;
  }

  const userId = req.nextUrl.searchParams.get('userId');

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch (e) {
    // 연결 자체가 실패(다운·DNS·타임아웃). 화면은 문구만 보여주고 삼키므로 여기서 남겨야 한다.
    await logError({
      source: 'server',
      route: `/api/ddx/${subPath}`,
      method: req.method,
      statusCode: 502,
      feature: 'ddx_proxy',
      message: `ddx-api 연결 실패: ${e instanceof Error ? e.message : String(e)}`,
      userId,
      context: { target },
    });
    return new Response(JSON.stringify({ success: false, error: 'ddx-api 연결에 실패했습니다.' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }

  // upstream 이 4xx/5xx 면 admin 에러 로그에 남긴다.
  // 브라우저는 이 실패를 catch 해 문구만 띄우고 끝내서(ddx-api.ts), 지금까지 아무 데도 기록되지 않았다.
  // 403(계정 미동기화)은 사용자 안내로 처리되는 정상 흐름이라 제외.
  if (!upstream.ok && upstream.status !== 403) {
    await logError({
      source: 'server',
      route: `/api/ddx/${subPath}`,
      method: req.method,
      statusCode: upstream.status,
      feature: 'ddx_proxy',
      message: `ddx-api ${upstream.status} (${req.method} /${subPath})`,
      userId,
      context: { target },
    });
  }

  // 상태 + 본문(스트림 포함) 그대로 전달. SSE(text/event-stream)도 통과.
  const respHeaders = new Headers();
  const upCt = upstream.headers.get('content-type');
  if (upCt) respHeaders.set('content-type', upCt);
  const cacheControl = upstream.headers.get('cache-control');
  if (cacheControl) respHeaders.set('cache-control', cacheControl);

  return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
}
