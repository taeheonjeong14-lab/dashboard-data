import type { OcrRow } from '@/lib/google-vision';

export type OrderedLine = { page: number; text: string };
export type BucketedLine = {
  page: number;
  text: string;
  corrected: boolean;
  originalText?: string;
};

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
