import type { LabItem } from '@/lib/lab-parser';
import { isDiagnosisTrendSectionTitle } from '@/lib/text-bucketing/chart-bucket-rules';
import { isPlusVetLabMachinePanelHeaderLine } from '@/lib/text-bucketing/chart-dates';

type LineIn = { page: number; text: string };

const ARROWS = ['↓', '↑', '←', '→'] as const;

/** 단위 후보 (긴 것부터 매칭) */
const PLUSVET_UNITS_LONGEST_FIRST = [
  '10*6/uL',
  '10*3/uL',
  '10×12/L',
  '10×9/L',
  '10×3/μL',
  '10×10/L',
  '10^12/L',
  '10^9/L',
  // 세포수 카운트 단위 (ProCyte/Catalyst). OCR이 K를 그리스 카파(Κ), μ를 그리스 뮤로 뽑음 → canonUnit에서 흡수.
  'K/μL',
  'M/μL',
  'mmol/L',
  'μmol/L',
  'umol/L',
  'mIU/L',
  'mEq/L',
  'mg/dL',
  'μg/dL',
  'ug/dL',
  'ug/mL',
  'ng/mL',
  'pg/mL',
  'pmol/L',
  'mg/L',
  'g/dL',
  'U/L',
  'IU/L',
  'mmHg',
  'fL',
  'pg',
  'uL',
  '%',
];

function normalizeSpaces(s: string) {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * 이전 줄에 이어 붙는 OCR/줄바꿈 (예: `↑5-5.001`, `← 5-5.001`)
 */
function isContinuationLine(t: string): boolean {
  const s = t.trim();
  if (!s) return false;
  if (/^←\s/.test(s) || /^→\s/.test(s)) return true;
  if (/^[↓↑]/.test(s)) {
    const rest = s.slice(1).trim();
    if (/^[\d.\s\-+]+$/.test(rest)) return true;
  }
  return false;
}

function mergeContinuationRows(rows: LineIn[]): LineIn[] {
  const out: LineIn[] = [];
  for (const row of rows) {
    const t = normalizeSpaces(row.text);
    if (!t) continue;
    if (isContinuationLine(row.text) && out.length > 0) {
      const prev = out[out.length - 1];
      out[out.length - 1] = {
        page: prev.page,
        text: normalizeSpaces(`${prev.text} ${t}`),
      };
      continue;
    }
    out.push({ page: row.page, text: t });
  }
  return out;
}

/**
 * 3줄 세로 포맷 병합: 항목명(숫자 없음) + 결과값 줄(숫자로 시작) → 한 줄로 합침.
 * mergeContinuationRows 이후에 실행해야 ↑↓ 접미사가 이미 앞 줄에 붙어 있음.
 */
function mergeVerticalLabItems(rows: LineIn[]): LineIn[] {
  const out: LineIn[] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i]!;
    const next = rows[i + 1];
    // 현재 줄: 숫자·화살표 없음(항목명), 다음 줄: 숫자로 시작(값). "< 10" 처럼 부등호 뒤 공백 허용.
    if (!/\d/.test(row.text) && row.text.trim() && next && /^[<>≤≥]?\s*\d/.test(next.text.trim())) {
      out.push({ page: row.page, text: normalizeSpaces(`${row.text} ${next.text}`) });
      i += 2;
    } else {
      out.push(row);
      i += 1;
    }
  }
  return out;
}

/** 단독 줄로 떨어진 참고범위(예: "2.2-4", "151-600")를 화살표 없는 정상값 항목 줄에 흡수.
 *  (화살표가 붙은 항목은 mergeContinuationRows 에서 이미 참고범위를 흡수함 → 여기선 화살표 없는 줄만 대상) */
function mergeOrphanRefRanges(rows: LineIn[]): LineIn[] {
  const isPureRefRange = (t: string) => /^-?\d+(?:\.\d+)?\s*-\s*-?\d+(?:\.\d+)?$/.test(t.trim());
  const out: LineIn[] = [];
  for (const row of rows) {
    const t = normalizeSpaces(row.text);
    if (!t) continue;
    const prev = out[out.length - 1];
    if (
      isPureRefRange(t) &&
      prev &&
      /\d/.test(prev.text) &&
      !ARROWS.some((a) => prev.text.includes(a)) &&
      !isPureRefRange(prev.text)
    ) {
      out[out.length - 1] = { page: prev.page, text: normalizeSpaces(`${prev.text} ${t}`) };
      continue;
    }
    out.push({ page: row.page, text: t });
  }
  return out;
}

function lastArrowSplit(s: string): { head: string; arrow: string | null; refAfterArrow: string } {
  let idx = -1;
  let ch: string | null = null;
  for (const a of ARROWS) {
    const i = s.lastIndexOf(a);
    if (i > idx) {
      idx = i;
      ch = a;
    }
  }
  if (idx < 0 || !ch) {
    return { head: s.trim(), arrow: null, refAfterArrow: '' };
  }
  return {
    head: s.slice(0, idx).trim(),
    arrow: ch,
    refAfterArrow: s.slice(idx + ch.length).trim(),
  };
}

function flagFromArrow(arrow: string | null, lhLetter: 'L' | 'H' | null): LabItem['flag'] {
  if (arrow === '↓') return 'low';
  if (arrow === '↑') return 'high';
  if (arrow === '←' || arrow === '→') return 'unknown';
  if (lhLetter === 'L') return 'low';
  if (lhLetter === 'H') return 'high';
  if (!arrow) return 'normal';
  return 'unknown';
}

/** 끝에서 참고구간 (숫자-숫자, 음수 끝은 --) */
function stripTrailingRefRange(head: string): { head: string; ref: string | null } {
  const h = head.trim();

  const doubleNeg = h.match(/^(.+?)\s+(-?\d+(?:\.\d+)?)--(-?\d+(?:\.\d+)?)\s*$/);
  if (doubleNeg) {
    return { head: doubleNeg[1].trim(), ref: `${doubleNeg[2]}--${doubleNeg[3]}` };
  }

  const simple = h.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*$/);
  if (simple) {
    return { head: simple[1].trim(), ref: `${simple[2]}-${simple[3]}` };
  }

  return { head: h, ref: null };
}

function stripTrailingLH(head: string): { head: string; lh: 'L' | 'H' | null } {
  const m = head.match(/^(.+)\s+([LH])\s*$/);
  if (m && m[1] && m[2]) {
    return { head: m[1].trim(), lh: m[2] as 'L' | 'H' };
  }
  return { head: head.trim(), lh: null };
}

// 곱셈기호(× * x)·마이크로(μ µ u)·그리스 카파(Κ κ→k) 표기 차이를 흡수해 단위 매칭.
// (텍스트레이어는 "10x9/L"·"K/uL", 스캔 OCR은 "10×9/L"·"Κ/μL"처럼 그리스 문자로 뽑힘)
function canonUnit(s: string): string {
  return s
    .toLowerCase()
    .replace(/[×*]/g, 'x')
    .replace(/[μµ]/g, 'u')
    .replace(/[κΚ]/g, 'k');
}

function stripTrailingUnit(head: string): { head: string; unit: string | null } {
  const h = head.trim();
  const ch = canonUnit(h);

  for (const u of PLUSVET_UNITS_LONGEST_FIRST) {
    const suf = ` ${u}`;
    // canonUnit 은 문자 1:1 치환이라 길이 보존 → slice 인덱스 그대로 사용 가능.
    if (ch.endsWith(canonUnit(suf))) {
      return { head: h.slice(0, h.length - suf.length).trimEnd(), unit: u };
    }
  }

  const pct = h.match(/^(.*)\s+(\d+(?:\.\d+)?)%\s*$/);
  if (pct?.[1] != null && pct[2] != null) {
    return { head: `${pct[1].trim()} ${pct[2]}`.trim(), unit: '%' };
  }

  return { head: h, unit: null };
}

/** NEG(2) / POS(1) 형태의 키트 정성 결과 파싱 */
function splitItemAndQualitativeValue(head: string): { itemName: string; valueText: string; flag: LabItem['flag'] } | null {
  const m = head.trim().match(/^(.+?)\s+((?:NEG|POS|POSITIVE|NEGATIVE|TNTC|\+{1,3})(?:\s*\(\d+\))?)\s*$/i);
  if (!m?.[1] || !m[2]) return null;
  const itemName = m[1].trim();
  const valueText = m[2].trim();
  let flag: LabItem['flag'];
  if (/^NEG/i.test(valueText) || /^NEGATIVE/i.test(valueText)) flag = 'normal';
  else if (/^POS/i.test(valueText) || /^POSITIVE/i.test(valueText) || valueText.startsWith('+')) flag = 'high';
  else flag = 'unknown';
  return { itemName, valueText, flag };
}

/**
 * head에서 맨 끝을 검사값으로 분리 (A/G, BUN/CRE, BE(ecf), f.NT-proBNP 등 슬래시·괄호 보존)
 */
function splitItemAndValue(head: string): { itemName: string; valueText: string } | null {
  const h = head.trim();
  const valueRx = '(?:[<>≤≥]\\s*\\d+(?:\\.\\d+)?|[-+]?\\d+(?:\\.\\d+)?)';
  const m = h.match(new RegExp(`^(.+?)\\s+(${valueRx})\\s*$`));
  if (m?.[1] && m[2]) {
    const item = m[1].trim();
    const val = m[2].replace(/\s+/g, '').trim();
    if (item && val) return { itemName: item, valueText: val };
  }
  return null;
}

function numericFromValueText(valueText: string): number | null {
  const t = valueText.replace(/,/g, '.').replace(/^</, '').replace(/^>/, '').trim();
  const m = t.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number.parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}

export function parsePlusVetLabLine(line: string, page: number): LabItem | null {
  const s = normalizeSpaces(line);
  if (!s || isPlusVetLabMachinePanelHeaderLine(s)) return null;
  if (/^20\d{2}[./-]\d{1,2}[./-]\d{1,2}\s+\d{1,2}:\d{2}/.test(s) && /\|/.test(s)) {
    return null;
  }

  const { head: h0, arrow, refAfterArrow } = lastArrowSplit(s);
  let referenceRange: string | null = refAfterArrow.trim() ? refAfterArrow.trim() : null;
  let work = h0;
  let lh: 'L' | 'H' | null = null;

  if (!arrow) {
    const lhStripped = stripTrailingLH(work);
    work = lhStripped.head;
    lh = lhStripped.lh;
  }

  if (!referenceRange) {
    const refStripped = stripTrailingRefRange(work);
    work = refStripped.head;
    referenceRange = refStripped.ref;
  }

  const { head: hUnit, unit } = stripTrailingUnit(work);
  const split = splitItemAndValue(hUnit);
  if (!split) {
    // 키트 정성 결과 (NEG/POS) fallback
    const qual = splitItemAndQualitativeValue(hUnit);
    if (!qual) return null;
    return {
      page,
      rowY: 0,
      itemName: qual.itemName,
      value: null,
      valueText: qual.valueText,
      unit,
      referenceRange,
      flag: qual.flag,
      rawRow: s,
    };
  }

  const { itemName, valueText } = split;
  if (!itemName || !valueText) return null;

  const flag = flagFromArrow(arrow, lh);

  return {
    page,
    rowY: 0,
    itemName,
    value: numericFromValueText(valueText),
    valueText,
    unit,
    referenceRange,
    flag,
    rawRow: s,
  };
}

export function parsePlusVetLabBucketLines(lines: LineIn[]): LabItem[] {
  const untilTrend: LineIn[] = [];
  for (const row of lines) {
    if (isDiagnosisTrendSectionTitle(row.text)) break;
    untilTrend.push(row);
  }
  const merged = mergeOrphanRefRanges(mergeVerticalLabItems(mergeContinuationRows(untilTrend)));
  const items: LabItem[] = [];
  for (const row of merged) {
    const item = parsePlusVetLabLine(row.text, row.page);
    if (item) items.push(item);
  }
  return items;
}

