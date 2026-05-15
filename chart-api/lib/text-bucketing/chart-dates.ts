import type { ChartKind } from '@/lib/text-bucketing/chart-kind';

/** IntoVet 방문 앵커(대괄호 날짜 등) + 일반적인 OCR 변형 */
export function isVisitContextLine(text: string) {
  const canonicalBracketed =
    /\[\s*20\d{2}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2}:\d{2}\s*\]/;
  if (canonicalBracketed.test(text)) {
    return true;
  }

  const broadVariants =
    /\[?\s*(?:20\d{2}[./-]\d{1,2}[./-]\d{1,2}|\d{4}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일?)\s+[0-2]?\d:[0-5]\d(?::[0-5]\d)?\s*\]?/;
  return broadVariants.test(text);
}

export function extractIntoVetDateTime(text: string) {
  const match = text.match(/\[\s*(20\d{2}-\d{1,2}-\d{1,2}\s+[0-2]?\d:[0-5]\d:[0-5]\d)\s*\]/);
  if (match?.[1]) return match[1];
  const broad = text.match(/(20\d{2}[./-]\d{1,2}[./-]\d{1,2}\s+[0-2]?\d:[0-5]\d(?::[0-5]\d)?)/);
  return broad?.[1] ?? null;
}

function normalizeYmdParts(y: string, mo: string, d: string) {
  const m = String(Number.parseInt(mo, 10)).padStart(2, '0');
  const day = String(Number.parseInt(d, 10)).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Lab 묶음 날짜 키 (인투벳·플러스벳·이프렌즈 공통).
 * - 시간 있음: `yyyy-mm-dd` + (오전|오후)? + `hh:mm` 등 — 원문 구분자 유지
 * - **날짜만** (줄 전체): `YYYY-MM-DD`로 정규화 (이프렌즈 Laboratory date 앵커 등)
 */
export function extractLabDateTime(text: string) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const match = normalized.match(
    /\[?\s*(20\d{2}[./-]\d{1,2}[./-]\d{1,2})\s*(?:(오전|오후|am|pm)\s*)?([0-2]?\d:[0-5]\d(?::[0-5]\d)?)\s*\]?/i,
  );
  if (match) {
    return `${match[1]} ${match[2] ? `${match[2]} ` : ''}${match[3]}`.trim();
  }
  const dateOnly = normalized.match(/^(20\d{2})[./-](\d{1,2})[./-](\d{1,2})\s*$/);
  if (dateOnly) {
    return normalizeYmdParts(dateOnly[1] ?? '', dateOnly[2] ?? '', dateOnly[3] ?? '');
  }
  return null;
}

/**
 * 플러스벳 "진단 검사 결과" 구간에서 검사 시각 줄만 인정 (줄 **시작**이 날짜+시각).
 * 제목 직후 반복되는 기본정보 줄이 lab으로 들어가지 않게 한다.
 */
export function extractPlusVetLabSectionAnchorDateTime(text: string): string | null {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const m = normalized.match(
    /^(?:\[)?\s*(20\d{2}[./-]\d{1,2}[./-]\d{1,2})\s+(?:(오전|오후|am|pm)\s*)?([0-2]?\d:[0-5]\d(?::[0-5]\d)?)\b/i,
  );
  if (!m) return null;
  const mer = m[2] ? `${m[2]} ` : '';
  return `${m[1]} ${mer}${m[3]}`.trim();
}

function matchPlusVetDatetimePipeRest(text: string): { line: string; afterFirstPipe: string } | null {
  const line = text.replace(/\s+/g, ' ').trim();
  const m = line.match(
    /^(?:\[)?\s*(20\d{2}[./-]\d{1,2}[./-]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?)\s*\|\s*(.+)$/i,
  );
  if (!m) return null;
  return { line, afterFirstPipe: m[2].trim() };
}

/**
 * `2026.01.30 14:54 | Serum Analysis (Serum Analysis) | V200` 처럼
 * 진단 검사 결과 블록 없이 기계검사만 이어지는 PlusVet 출력용 lab 헤더.
 * 차트 방문 줄(`… | 재진 | …`)은 제외.
 */
export function isPlusVetLabMachinePanelHeaderLine(text: string): boolean {
  const hit = matchPlusVetDatetimePipeRest(text);
  if (!hit) return false;
  if (/^(재진|초진|예진|응급|검진|당일|복진|외래)\b/.test(hit.afterFirstPipe)) return false;
  if (/\bAnalysis\b/i.test(hit.line)) return true;
  if (/\bCBC\b/i.test(hit.line)) return true;
  if (/Biochemical/i.test(hit.line)) return true;
  if (/Blood\s+Gas/i.test(hit.line)) return true;
  return false;
}

/** PlusVet 차트 본문 방문 헤더 — lab 구간을 끊고 chartBody로 복귀 */
export function isPlusVetChartVisitHeaderLine(text: string): boolean {
  const hit = matchPlusVetDatetimePipeRest(text);
  if (!hit) return false;
  return /^(재진|초진|예진|응급|검진|당일|복진|외래)\b/.test(hit.afterFirstPipe);
}

/** 차트 본문을 날짜별로 나눌 때 사용하는 앵커 */
export function extractChartBodyDateKey(text: string, kind: ChartKind): string | null {
  const iv = extractIntoVetDateTime(text);
  if (kind === 'intovet') return iv;
  return iv ?? extractLabDateTime(text);
}

function normalizeYmdDateOnly(text: string): string | null {
  const m = text.match(/\b(20\d{2})[./-](\d{1,2})[./-](\d{1,2})\b/);
  if (!m) return null;
  return normalizeYmdParts(m[1] ?? '', m[2] ?? '', m[3] ?? '');
}

export function extractEfriendsVisitDateKey(text: string): string | null {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const labeled = t.match(/^date\s*:\s*(20\d{2}[./-]\d{1,2}[./-]\d{1,2})\b/i);
  if (labeled?.[1]) {
    return normalizeYmdDateOnly(labeled[1]);
  }
  const soap = t.match(/^(20\d{2}[./-]\d{1,2}[./-]\d{1,2})\s*[SOP]\)/i);
  if (soap?.[1]) {
    return normalizeYmdDateOnly(soap[1]);
  }
  return null;
}
