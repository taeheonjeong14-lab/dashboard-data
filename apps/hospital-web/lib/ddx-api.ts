// 동일 출처 프록시를 경유한다 — ddx-api 가 CORS 를 허용하지 않으므로 브라우저 직접 호출은 차단됨.
// 로그인 사용자: /api/ddx (미들웨어 인증). 비로그인 공개(보호자 사전문진): /api/ddx-public.
const DDX_API = '/api/ddx';
const DDX_API_PUBLIC = '/api/ddx-public';

export async function ddxGet<T>(path: string, userId: string): Promise<T> {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${DDX_API}${path}${sep}userId=${encodeURIComponent(userId)}`);
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
  if (res.status === 403) {
    throw new DdxApiForbiddenError();
  }
  if (!res.ok) {
    throw new Error(`ddx-api error: ${res.status}`);
  }
  return res;
}

// 공개(로그인 불필요) 엔드포인트용 — userId 를 붙이지 않고 공개 프록시를 경유. (예: /api/survey 토큰 기반)
export async function ddxGetPublic<T>(path: string): Promise<T> {
  const res = await fetch(`${DDX_API_PUBLIC}${path}`);
  if (!res.ok) {
    throw new Error(`ddx-api error: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function ddxPostPublic<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`${DDX_API_PUBLIC}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`ddx-api error: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export class DdxApiForbiddenError extends Error {
  constructor() {
    super('ddx-api 계정 동기화가 필요합니다. 관리자에게 문의하세요.');
    this.name = 'DdxApiForbiddenError';
  }
}
