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
