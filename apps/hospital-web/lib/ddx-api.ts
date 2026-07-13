// 동일 출처 프록시를 경유한다 — ddx-api 가 CORS 를 허용하지 않으므로 브라우저 직접 호출은 차단됨.
// 로그인 사용자: /api/ddx (미들웨어 인증). 비로그인 공개(보호자 사전문진): /api/ddx-public.
import { goToLogin } from '@/components/shell/session-watcher';

const DDX_API = '/api/ddx';
const DDX_API_PUBLIC = '/api/ddx-public';

/**
 * 세션이 만료되면 미들웨어가 401 을 준다(예전엔 /login 307 리다이렉트 → POST 가 유지돼 405).
 * 화면에 에러 문구만 띄우지 말고 로그인 화면으로 보낸다 — 사용자는 로그아웃된 줄 모르고 있다.
 */
function redirectIfSessionExpired(res: Response): void {
  if (res.status === 401) goToLogin();
}

export async function ddxGet<T>(path: string, userId: string): Promise<T> {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${DDX_API}${path}${sep}userId=${encodeURIComponent(userId)}`);
  redirectIfSessionExpired(res);
  if (res.status === 403) {
    throw new DdxApiForbiddenError();
  }
  if (!res.ok) {
    throw new Error(`ddx-api error: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function ddxPost<T>(path: string, userId: string, body: object): Promise<T> {
  const res = await fetch(`${DDX_API}${path}?userId=${encodeURIComponent(userId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  redirectIfSessionExpired(res);
  if (res.status === 403) {
    throw new DdxApiForbiddenError();
  }
  if (!res.ok) {
    throw new Error(`ddx-api error: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function ddxPostStream(
  path: string,
  userId: string,
  body: object,
): Promise<Response> {
  const res = await fetch(`${DDX_API}${path}?userId=${encodeURIComponent(userId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  redirectIfSessionExpired(res);
  if (res.status === 403) {
    throw new DdxApiForbiddenError();
  }
  if (!res.ok) {
    throw new Error(`ddx-api error: ${res.status}`);
  }
  return res;
}

// 공개(로그인 불필요) 엔드포인트용 — userId 를 붙이지 않고 공개 프록시를 경유. (예: /api/survey 토큰 기반)
// 비정상 응답이면 본문의 error 메시지를 우선 사용(없으면 상태코드).
async function errorFromRes(res: Response): Promise<Error> {
  try {
    const j = (await res.json()) as { error?: string };
    if (j?.error) return new Error(j.error);
  } catch { /* 본문 파싱 실패 시 무시 */ }
  return new Error(`ddx-api error: ${res.status}`);
}

export async function ddxGetPublic<T>(path: string): Promise<T> {
  const res = await fetch(`${DDX_API_PUBLIC}${path}`);
  if (!res.ok) throw await errorFromRes(res);
  return res.json() as Promise<T>;
}

export async function ddxPostPublic<T>(path: string, body: object, init?: { keepalive?: boolean }): Promise<T> {
  const res = await fetch(`${DDX_API_PUBLIC}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    // keepalive: 사용자가 제출 직후 화면을 닫아도 요청이 끝까지 전송되도록 한다(사전문진 최종 제출용).
    keepalive: init?.keepalive,
  });
  if (!res.ok) throw await errorFromRes(res);
  return res.json() as Promise<T>;
}

export class DdxApiForbiddenError extends Error {
  constructor() {
    super('ddx-api 계정 동기화가 필요합니다. 관리자에게 문의하세요.');
    this.name = 'DdxApiForbiddenError';
  }
}
