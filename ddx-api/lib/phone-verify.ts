import { createHash } from 'crypto';

// 휴대폰 본인인증(PortOne/아임포트) 서버 검증 추상화.
// 키(PORTONE_API_KEY/SECRET)가 있으면 imp_uid 로 실제 결과 조회, 없으면 dev STUB.
// 운영 전 반드시 PortOne 키를 넣어 실연동할 것. STUB 는 phone 해시로 결정적 di 를 만들어 중복 로직 테스트만 가능.

export type PhoneVerifyResult = {
  name: string;
  phone: string; // 숫자만
  ci: string; // 연계정보(사람 고유)
  di: string; // 중복확인정보(서비스 내)
  verified: boolean; // 실제 통신사 인증 여부(STUB=false)
};

const PORTONE_API = 'https://api.iamport.kr';

export function isPhoneVerifyConfigured(): boolean {
  return Boolean(process.env.PORTONE_API_KEY && process.env.PORTONE_API_SECRET);
}

async function getToken(apiKey: string, apiSecret: string): Promise<string | null> {
  const res = await fetch(`${PORTONE_API}/users/getToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imp_key: apiKey, imp_secret: apiSecret }),
  });
  const j = (await res.json().catch(() => null)) as { response?: { access_token?: string } } | null;
  return j?.response?.access_token ?? null;
}

export async function verifyPhone(input: { impUid?: string; phone?: string; name?: string }): Promise<PhoneVerifyResult> {
  const apiKey = process.env.PORTONE_API_KEY;
  const apiSecret = process.env.PORTONE_API_SECRET;

  if (apiKey && apiSecret && input.impUid) {
    const token = await getToken(apiKey, apiSecret);
    if (!token) throw new Error('본인인증 토큰 발급 실패');
    const res = await fetch(`${PORTONE_API}/certifications/${encodeURIComponent(input.impUid)}`, {
      headers: { Authorization: token },
    });
    const j = (await res.json().catch(() => null)) as {
      response?: { name?: string; phone?: string; unique_key?: string; unique_in_site?: string };
    } | null;
    const r = j?.response;
    if (!r || !r.unique_key) throw new Error('본인인증 결과 조회 실패');
    return {
      name: r.name ?? '',
      phone: (r.phone ?? '').replace(/\D/g, ''),
      ci: r.unique_key ?? '',
      di: r.unique_in_site ?? '',
      verified: true,
    };
  }

  // ── STUB (PortOne 키 미설정) ──
  const phone = (input.phone ?? '').replace(/\D/g, '');
  const seed = phone || `rand-${Math.random()}`;
  const di = 'stub-di-' + createHash('sha256').update(seed).digest('hex').slice(0, 24);
  const ci = 'stub-ci-' + createHash('sha256').update('ci:' + seed).digest('hex').slice(0, 32);
  return { name: input.name ?? '', phone, ci, di, verified: false };
}
