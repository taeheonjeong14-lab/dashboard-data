/**
 * 에러 로그에 실릴 값에서 민감정보를 지운다. 의존성 없는 순수 모듈 — 단독으로 테스트 가능해야 한다.
 * (원본: apps/hospital-web/lib/redact.ts 를 공유 패키지로 승격. 새 민감 필드는 여기에 추가.)
 *
 * 두 겹으로 거른다:
 *   1) 키 이름 denylist  — REDACT_KEYS / REDACT_KEY_PATTERNS
 *   2) 값 패턴 매칭      — 전화·주민번호·이메일은 키 이름과 무관하게 마스킹
 */

// 정규화(소문자 + 영숫자만) 후 완전 일치로 비교. 'patient_name' → 'patientname'
export const REDACT_KEYS = new Set([
  // 신원
  'name', 'patientname', 'guardianname', 'ownername', 'username', 'fullname',
  'phone', 'phonenumber', 'tel', 'telephone', 'mobile', 'contact',
  'email', 'address', 'addressdetail', 'zipcode', 'postcode',
  'rrn', 'ssn', 'birth', 'birthdate', 'birthday', 'dob',
  // 결제
  'cardnumber', 'account', 'accountnumber', 'cvc',
  // 임상 자유서술 — 수의 진료 내용이 그대로 들어온다
  'memo', 'note', 'notes', 'symptom', 'symptoms', 'diagnosis',
  'soap', 'chiefcomplaint', 'history', 'content', 'answer', 'answers',
]);

const REDACT_KEY_PATTERNS = [/password/, /passwd/, /secret/, /token/, /apikey/, /accesskey/, /authorization/, /cookie/, /credential/];

// 키를 못 걸렀을 때의 2차 방어. 값 문자열 안에서 형태로 잡는다.
const VALUE_PATTERNS: Array<[RegExp, string]> = [
  [/\d{6}\s*-\s*[1-4]\d{6}/g, '[redacted:rrn]'],
  [/01[016-9][-\s]?\d{3,4}[-\s]?\d{4}/g, '[redacted:phone]'],
  [/0\d{1,2}[-\s]\d{3,4}[-\s]\d{4}/g, '[redacted:phone]'],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[redacted:email]'],
];

const MAX_DEPTH = 4;
const MAX_ARRAY = 20;
const MAX_STRING = 500;
const MAX_JSON_BYTES = 8_000;

export function isRedactedKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (REDACT_KEYS.has(k)) return true;
  return REDACT_KEY_PATTERNS.some((re) => re.test(k));
}

function scrubString(s: string): string {
  let out = s.length > MAX_STRING ? `${s.slice(0, MAX_STRING)}…(${s.length}자)` : s;
  for (const [re, replacement] of VALUE_PATTERNS) out = out.replace(re, replacement);
  return out;
}

export function redactPayload(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth >= MAX_DEPTH) return '[redacted:depth]';

  if (typeof value === 'string') return scrubString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (Array.isArray(value)) {
    const head = value.slice(0, MAX_ARRAY).map((v) => redactPayload(v, depth + 1));
    return value.length > MAX_ARRAY ? [...head, `…외 ${value.length - MAX_ARRAY}개`] : head;
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isRedactedKey(k) ? '[redacted]' : redactPayload(v, depth + 1);
    }
    return out;
  }

  return '[redacted:unsupported]';
}

/** 마스킹 후에도 큰 본문은 잘라낸다. 저장 실패보다 잘린 로그가 낫다. */
export function capSize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  const json = JSON.stringify(value);
  if (json === undefined) return null;
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes <= MAX_JSON_BYTES) return value;
  return { _truncated: true, _bytes: bytes, preview: json.slice(0, 1_000) };
}
