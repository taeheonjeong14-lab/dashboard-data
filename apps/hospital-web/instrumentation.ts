/**
 * Next 의 전역 서버 오류 훅. 라우트 핸들러·서버 컴포넌트·서버 액션에서 "던져진" 예외를
 * 라우트 수정 없이 전부 잡는다.
 *
 * 한계: 라우트가 스스로 try/catch 해서 500 을 정상 리턴하면 여기로 오지 않는다.
 * 그 경우는 withErrorLog 래퍼가 응답 상태코드를 보고 잡는다. 둘은 상호 보완 관계다.
 */
export async function onRequestError(
  err: unknown,
  request: { path: string; method: string; headers: Record<string, string | undefined> },
  context: { routerKind: string; routePath: string; routeType: string },
): Promise<void> {
  // edge 런타임에서는 service-role 클라이언트(node:crypto 의존)를 못 쓴다.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  try {
    const { logError, isAlreadyLogged } = await import('@/lib/error-log');
    // withErrorLog 가 이미 적재하고 되던진 예외는 건너뛴다(중복 방지).
    if (isAlreadyLogged(err)) return;

    const error = err instanceof Error ? err : new Error(String(err));

    await logError({
      source: 'server',
      route: context.routePath || request.path,
      method: request.method,
      statusCode: 500,
      message: error.message,
      stack: error.stack ?? null,
      context: {
        path: request.path,
        routerKind: context.routerKind,
        routeType: context.routeType,
        userAgent: request.headers['user-agent'],
        // uncaught 경로라 세션을 안전하게 읽을 수 없다. 식별자는 withErrorLog 쪽에서 채워진다.
        uncaught: true,
      },
    });
  } catch (e) {
    console.error('[instrumentation] onRequestError 적재 실패:', e);
  }
}
