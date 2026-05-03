/**
 * 외부 URL fetch 전 검증 — 메타데이터 서버·사설망 등 SSRF 완화.
 * 완벽한 방어는 아니며, 운영 환경에서 필요 시 호스트 허용 목록을 추가한다.
 */

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '0.0.0.0',
  '[::1]',
  'metadata.google.internal',
]);

export class UnsafeUrlError extends Error {
  constructor(message = '허용되지 않은 URL입니다.') {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

function ipv4Public(hostname: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!m) return true;
  const a = Number(m[1]), b = Number(m[2]), c = Number(m[3]), d = Number(m[4]);
  if ([a, b, c, d].some((x) => x > 255)) return false;
  if (a === 10) return false;
  if (a === 127) return false;
  if (a === 0) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  return true;
}

/** 브라우저 등에서 넘어온 문자열을 검증하고 URL 객체로 반환 */
export function parseSafeHttpUrl(raw: string | null): URL {
  if (!raw?.trim()) throw new UnsafeUrlError('url 파라미터가 필요합니다.');
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new UnsafeUrlError('URL 형식이 올바르지 않습니다.');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new UnsafeUrlError('http(s) URL만 허용됩니다.');
  }
  const host = u.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host)) throw new UnsafeUrlError();
  if (host.endsWith('.localhost') || host.endsWith('.local')) throw new UnsafeUrlError();
  if (!ipv4Public(host)) throw new UnsafeUrlError('사설·예약 주소는 허용되지 않습니다.');
  return u;
}
