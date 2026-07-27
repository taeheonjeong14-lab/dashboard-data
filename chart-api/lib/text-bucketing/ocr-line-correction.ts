import type { OcrRow } from '@/lib/google-vision';

export type OrderedLine = { page: number; text: string };
export type BucketedLine = {
  page: number;
  text: string;
  corrected: boolean;
  originalText?: string;
};

/**
 * 라틴 글자로 착각하기 쉬운 그리스·키릴 글자 → 라틴 치환표.
 *
 * 전사 LLM 에게 "라틴/한글만 쓰라"고 지시(SCRIPT RULES)해도 같은 자리에서 계속 새기 때문에
 * 확정적으로 되돌린다. 실제 피해는 이름 오염보다 **중복 제거 실패**가 크다 — 전사가 같은 줄을
 * 두 번 뱉을 때 한쪽만 그리스 문자면(WBC-MONO% / WBC-MONΟ%) 문자열이 달라 중복이 안 합쳐지고
 * 검사 항목이 두 줄로 남는다.
 *
 * 의학에서 실제로 쓰는 그리스 문자(α2-agonist, β-lactam, μ 마이크로 등)는 넣지 않는다.
 */
const CONFUSABLE_TO_LATIN: Record<string, string> = {
  // 그리스 대문자
  'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'H', 'Ι': 'I', 'Κ': 'K', 'Μ': 'M',
  'Ν': 'N', 'Ο': 'O', 'Ρ': 'P', 'Τ': 'T', 'Υ': 'Y', 'Χ': 'X',
  // 그리스 소문자 중 라틴과 혼동되는 것만
  'ο': 'o',
  // 키릴 대문자
  'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O', 'Р': 'P',
  'С': 'C', 'Т': 'T', 'У': 'Y', 'Х': 'X',
  // 키릴 소문자
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x',
};

const CONFUSABLE_RE = new RegExp(`[${Object.keys(CONFUSABLE_TO_LATIN).join('')}]`, 'g');

/** 전사 결과에서 라틴 동음이형 글자를 라틴으로 되돌린다. 한글·숫자·진짜 그리스 문자는 건드리지 않는다. */
export function normalizeConfusableScripts(text: string): string {
  return text.replace(CONFUSABLE_RE, (ch) => CONFUSABLE_TO_LATIN[ch] ?? ch);
}

function tokenize(text: string) {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((v) => v.replace(/[^\p{L}\p{N}]+/gu, ''))
    .filter(Boolean);
}

function overlapScore(a: string, b: string) {
  const aSet = new Set(tokenize(a));
  const bSet = new Set(tokenize(b));
  if (aSet.size === 0 || bSet.size === 0) return 0;
  let overlap = 0;
  for (const token of aSet) {
    if (bSet.has(token)) overlap += 1;
  }
  return overlap / Math.max(aSet.size, bSet.size);
}

function containsNumericSignal(text: string) {
  return /\d/.test(text);
}

function normalizeLoose(text: string) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s./%\-~]/gu, '').replace(/\s+/g, ' ').trim();
}

export function minimalOcrCorrection(line: OrderedLine, rows: OcrRow[]): BucketedLine {
  const candidates = rows.filter((row) => row.page === line.page);
  if (candidates.length === 0 || !containsNumericSignal(line.text)) {
    return { page: line.page, text: line.text, corrected: false };
  }

  let best = line.text;
  let bestScore = 0;
  for (const row of candidates) {
    const score = overlapScore(line.text, row.text);
    if (score > bestScore) {
      bestScore = score;
      best = row.text;
    }
  }

  if (bestScore >= 0.9 && normalizeLoose(best) !== normalizeLoose(line.text)) {
    return {
      page: line.page,
      text: best,
      corrected: true,
      originalText: line.text,
    };
  }

  return { page: line.page, text: line.text, corrected: false };
}
