// 한글 조사 선택을 위한 받침(종성) 판별 유틸.
// 한글 음절은 (code - 0xAC00) % 28 === 0 이면 받침 없음(모음 끝), 아니면 받침 있음.

// 한국어 알파벳 읽기의 끝소리에 받침이 있는 라틴 문자(L=엘, M=엠, N=엔)만 true.
// 나머지(A 에이, D 디, V 브이 …)는 모음으로 끝나 받침 없음으로 본다.
const LATIN_FINAL_HAS_BATCHIM: Record<string, boolean> = { l: true, m: true, n: true };

/** 단어의 끝 글자에 받침이 있는지. 한글은 정확히, 영문 약어는 발음 끝소리로 근사. */
export function hasFinalConsonant(word: string): boolean {
  const w = (word ?? "").trim();
  if (!w) return false;
  const ch = w[w.length - 1];
  const code = ch.charCodeAt(0);
  // 한글 음절
  if (code >= 0xac00 && code <= 0xd7a3) {
    return (code - 0xac00) % 28 !== 0;
  }
  // 괄호로 끝나면 괄호 안 마지막 토큰 기준 — 예: "이첨판 폐쇄부전증(MMVD)"
  if (ch === ")" || ch === "]") {
    const inner = w.replace(/[)\]]+$/, "");
    const m = inner.match(/[([]([^()[\]]*)$/);
    if (m && m[1]) return hasFinalConsonant(m[1]);
  }
  // 영문 한 글자(약어 끝)
  if (/[a-zA-Z]$/.test(ch)) return LATIN_FINAL_HAS_BATCHIM[ch.toLowerCase()] ?? false;
  // 숫자·기호 등은 받침 없음으로 근사
  return false;
}

/** 「(이)란」 — 받침 있으면 "이란", 없으면 "란". (예: 방광결석이란? / 담낭슬러지란?) */
export function iranSuffix(word: string): string {
  return hasFinalConsonant(word) ? "이란" : "란";
}

// 애칭 '이' 뒤에 올 수 있는 조사의 첫 글자. '이'는 받침이 없으므로 은/을/과 계열은 오지 않는다.
const JOSA_AFTER_NAME_I = "는가를의도와랑라야에한처보만까부";

/**
 * 받침 없는 이름 뒤에 잘못 붙은 애칭 '이'를 걷어낸다. (예: 이름 "온도" → "온도이의" → "온도의")
 * 받침 있는 이름("버들이의")은 그대로 둔다. 이름에 받침이 없으면 그 자리의 '이'는 조사도 아니므로
 * 무조건 군더더기다. LLM 이 프롬프트 규칙을 자주 어겨서 생성 결과에 결정적으로 한 번 더 적용한다.
 */
export function fixNameISuffix(text: string, name: string): string {
  const n = (name ?? "").trim();
  if (!text || !n || hasFinalConsonant(n)) return text;
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // 앞 글자가 한글이면 이름이 아니라 더 긴 낱말의 꼬리다(이름 "도" ↔ 본문 "온도").
  const re = new RegExp(`(?<![가-힣])${esc}이(?=[${JOSA_AFTER_NAME_I}])`, "g");
  return text.replace(re, n);
}

/** LLM 생성 결과처럼 중첩된 객체·배열 전체의 문자열에 {@link fixNameISuffix} 를 적용한다. */
export function fixNameISuffixDeep<T>(value: T, name: string): T {
  if (typeof value === "string") return fixNameISuffix(value, name) as T;
  if (Array.isArray(value)) return value.map((v) => fixNameISuffixDeep(v, name)) as unknown as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, fixNameISuffixDeep(v, name)]),
    ) as T;
  }
  return value;
}
