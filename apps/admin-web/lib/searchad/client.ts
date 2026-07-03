import crypto from 'node:crypto';

// 네이버 검색광고 API 공통(서명·시크릿 복호화). python(naver-searchad-main.py)과 동일 방식.
// searchad-campaigns / naver-keyword 등 여러 라우트가 공유한다.

/** enc:: XOR(SHA256(passphrase)) 복호화. 평문이면 그대로. */
export function resolveSearchadSecret(stored: string): string {
  const v = (stored || '').trim();
  if (!v) return '';
  if (!v.startsWith('enc::')) return v; // 하위 호환(평문)
  const passphrase = (process.env.SEARCHAD_SECRET_PASSPHRASE || '').trim();
  if (!passphrase) throw new Error('SEARCHAD_SECRET_PASSPHRASE가 설정되지 않았습니다.');
  const raw = Buffer.from(v.slice('enc::'.length), 'base64');
  const key = crypto.createHash('sha256').update(passphrase, 'utf8').digest();
  const out = Buffer.alloc(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw[i] ^ key[i % key.length];
  return out.toString('utf8');
}

/** 검색광고 API 요청 서명 헤더. uri 는 쿼리스트링을 제외한 경로만(서명 규칙). */
export function signSearchadHeaders(
  method: string,
  uri: string,
  apiLicense: string,
  secretKey: string,
  customerId: string,
): Record<string, string> {
  const timestamp = String(Date.now());
  const signature = crypto
    .createHmac('sha256', secretKey)
    .update(`${timestamp}.${method}.${uri}`)
    .digest('base64');
  return {
    'Content-Type': 'application/json; charset=UTF-8',
    'X-Timestamp': timestamp,
    'X-API-KEY': apiLicense,
    'X-Customer': customerId,
    'X-Signature': signature,
  };
}

export function searchadBaseUrl(): string {
  return (process.env.SEARCHAD_API_BASE_URL || 'https://api.searchad.naver.com').replace(/\/$/, '');
}
