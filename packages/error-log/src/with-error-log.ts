import type { NextRequest } from 'next/server';
import { logError, markLogged } from './log-error';

/**
 * API 라우트 공통 오류 적재 래퍼. 앱 무관.
 *
 * 두 경우를 모두 잡는다:
 *   1) 핸들러가 예외를 던진 경우
 *   2) 핸들러가 스스로 try/catch 해서 5xx 를 "정상 리턴" 한 경우
 * 이 저장소의 라우트 대부분은 2)라서(예: chart-api blog-review), 예외만 잡는
 * instrumentation(onRequestError) 으로는 거의 아무것도 못 남긴다. 둘은 상호 보완.
 *
 * 세션 식별(userId/hospitalId)은 앱마다 방식이 달라 주입식(identify). 없으면 null.
 */

type Handler<C> = (req: NextRequest, ctx: C) => Promise<Response> | Response;

export type Identify = (req: NextRequest) => Promise<{ userId: string | null; hospitalId: string | null }>;

const MAX_LOGGED_BODY_BYTES = 100_000;

/** 로깅용 본문 읽기. JSON 이고 작을 때만. 실패하면 조용히 포기한다. */
async function safeReadBody(snapshot: Request | null): Promise<unknown> {
  if (!snapshot) return undefined;
  const type = snapshot.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) return undefined;
  const len = Number(snapshot.headers.get('content-length') ?? '0');
  if (len > MAX_LOGGED_BODY_BYTES) return { _skipped: 'body too large', _bytes: len };
  try {
    return await snapshot.json();
  } catch {
    return undefined;
  }
}

/** 5xx 응답 본문에서 에러 메시지를 뽑아본다. 원 응답은 건드리지 않는다(clone). */
async function peekMessage(res: Response): Promise<string> {
  try {
    const text = await res.clone().text();
    if (!text) return `HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
      const m = parsed.error ?? parsed.message;
      if (typeof m === 'string' && m) return m;
    } catch {
      /* JSON 아니면 원문 사용 */
    }
    return text.slice(0, 500);
  } catch {
    return `HTTP ${res.status}`;
  }
}

export function withErrorLog<C = unknown>(
  meta: { app: string; route: string; feature?: string; identify?: Identify },
  handler: Handler<C>,
): Handler<C> {
  return async (req: NextRequest, ctx: C) => {
    const method = req.method;
    const snapshot = method === 'GET' || method === 'HEAD' ? null : req.clone();

    const record = async (message: string, stack: string | null, statusCode: number | null) => {
      const [ids, requestBody] = await Promise.all([
        meta.identify ? meta.identify(req).catch(() => ({ userId: null, hospitalId: null })) : Promise.resolve({ userId: null, hospitalId: null }),
        safeReadBody(snapshot),
      ]);
      await logError({
        app: meta.app,
        source: 'server',
        route: meta.route,
        feature: meta.feature ?? null,
        method,
        statusCode,
        message,
        stack,
        userId: ids.userId,
        hospitalId: ids.hospitalId,
        requestBody,
        context: { url: req.nextUrl.pathname + req.nextUrl.search },
      });
    };

    try {
      const res = await handler(req, ctx);
      if (res.status >= 500) await record(await peekMessage(res), null, res.status);
      return res;
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      await record(err.message, err.stack ?? null, 500);
      // 여기서 다시 던지면 Next 가 onRequestError 로도 넘긴다. 표식을 달아 거기서 건너뛰게 한다.
      markLogged(e);
      throw e;
    }
  };
}
