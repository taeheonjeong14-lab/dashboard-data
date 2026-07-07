import type { LabItem } from '@/lib/lab-parser';
import { isDiagnosisTrendSectionTitle } from '@/lib/text-bucketing/chart-bucket-rules';
import { isPlusVetLabMachinePanelHeaderLine } from '@/lib/text-bucketing/chart-dates';
import { computeLabFlag } from '@dashboard/lab-normalize';

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

// 라틴 동형 그리스 대문자 → 라틴. 스캔 PDF OCR/LLM이 Latin 글자 자리에 그리스 대문자를 넣는 일이
// 잦다(예: 단위 Μ/μL·Κ/μL, 항목명 ΜΟΝΟ, 값 Ο). 소문자 μ(마이크로)는 정상 단위라 보존한다.
const GREEK_CAP_TO_LATIN: Record<string, string> = {
  'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'H',
  'Ι': 'I', 'Κ': 'K', 'Μ': 'M', 'Ν': 'N', 'Ο': 'O',
  'Ρ': 'P', 'Τ': 'T', 'Υ': 'Y', 'Χ': 'X', 'Ϲ': 'C',
};

/**
 * 추출 LLM/OCR 잔여물 정규화. 프롬프트로 라틴 전사를 강제하지만(1차 방어) 확률적이라,
 * 파서에서도 결정적으로 한 번 더 흡수해 검사 행이 통째로 누락되는 걸 막는다.
 *  - 값 자리의 단독 그리스 오미크론 Ο → 0 (이름 속 Ο 는 건드리지 않음)
 *  - 라틴 동형 그리스 대문자 → 라틴 (단위·항목명 정상화)
 *  - 꼬리 OCR 노이즈 제거: 끝의 대시런(----)·언더스코어, 아랍/히브리/키릴 잔여 토큰
 *    (IDEXX 참고범위 막대 그래픽이 ---- 로 전사돼 화살표 없는 행의 파싱을 막던 문제)
 */
function normalizeOcrArtifacts(text: string): string {
  let s = text;
  s = s.replace(/(^|\s)Ο(?=\s|$)/g, '$10'); // 단독 오미크론 → 0
  s = s.replace(/[ΑΒΕΖΗΙΚΜΝΟΡΤΥΧϹ]/g, (c) => GREEK_CAP_TO_LATIN[c] ?? c);
  s = s.replace(/[\s\-–—_]+$/u, ''); // 꼬리 대시런/언더스코어
  s = s.replace(/\s+[\p{sc=Arabic}\p{sc=Hebrew}\p{sc=Cyrillic}]+$/u, ''); // 꼬리 외래문자 잔여 토큰
  return normalizeSpaces(s);
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

/**
 * p5 "영상 검사 소견" 등에 반복 인쇄되는 환자/병원 메타데이터 줄.
 * "동물 등록 번호 3323" 처럼 숫자로 끝나면 lab 항목으로 오인되므로 제외한다.
 */
export function isPlusVetPatientInfoLine(t: string): boolean {
  if (/^(동물\s*등록\s*번호|동물명|축종|품종|보호자|연락처|주소|나이|성별)(?=$|\s|[\d:：(/])/.test(t)) return true;
  if (/동물병원|동물메디컬센터|동물의료센터/.test(t)) return true;
  if (/\b\d{2,4}-\d{3,4}-\d{4}\b/.test(t)) return true; // 전화번호
  return false;
}

export function parsePlusVetLabLine(line: string, page: number): LabItem | null {
  const s = normalizeSpaces(line);
  if (!s || isPlusVetLabMachinePanelHeaderLine(s)) return null;
  if (/^20\d{2}[./-]\d{1,2}[./-]\d{1,2}\s+\d{1,2}:\d{2}/.test(s) && /\|/.test(s)) {
    return null;
  }
  if (isPlusVetPatientInfoLine(s)) return null;

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

/**
 * 패널 헤더 줄 판정 → UA(요검사) 패널인지 반환.
 *  - true: UA/요검사 패널 헤더 (예: "... | UA Analysis (UA Analysis) | UA Analyzer")
 *  - false: 패널 헤더지만 UA 아님(CBC·화학 등)
 *  - null: 패널 헤더가 아님(일반 항목 줄)
 */
/** 텍스트에 요검사(UA) 패널 표식이 있는지. 날짜 그룹핑이 헤더 줄을 떼어가도(groupLabLinesByDate)
 *  그 헤더에서 UA 여부만 읽어 그룹에 실어 보내는 데 재사용한다. */
export function isUrinalysisPanelHeaderText(text: string): boolean {
  return /\bU\/?A\b|UA\s*Analy|Urinaly|Urine\b|요\s*검사|소변\s*검사/i.test(text);
}

function detectPlusVetPanelHeader(text: string): boolean | null {
  const s = normalizeSpaces(text);
  const isDateHeader = /^20\d{2}[./-]\d{1,2}[./-]\d{1,2}\s+\d{1,2}:\d{2}/.test(s) && s.includes('|');
  if (!isDateHeader && !isPlusVetLabMachinePanelHeaderLine(s)) return null;
  return isUrinalysisPanelHeaderText(s);
}

/** UA 특유 단위(Ery/µL, Leu/µL, /HPF 등)까지 떼어낸다. 값이 한글/기호면 보존. */
function stripTrailingUaUnit(rest: string): { head: string; unit: string | null } {
  const common = stripTrailingUnit(rest);
  if (common.unit) return common;
  const m = rest.match(/^(.*\S)\s+([A-Za-z]+(?:\/[A-Za-zµμ%]+)?|\/(?:HPF|LPF|hpf|lpf))\s*$/);
  if (m?.[1] && m[2]) return { head: m[1].trim(), unit: m[2] };
  return { head: rest, unit: null };
}

/**
 * UA(요검사) 섹션 한 줄 파싱. 값이 숫자가 아닐 수 있다(음성·미량·+·색 서술).
 *  - 첫 토큰 = 항목명(원문 그대로 보존). 소변 전용 이름(U-*) 매핑·메타(Collec) 드롭은 정규화 단계에서.
 *  - 값은 텍스트 그대로 저장. flag 는 숫자값+참고범위일 때만 계산, 정성/서술값은 판정 안 함(중립).
 */
function parsePlusVetUrinalysisLine(line: string, page: number): LabItem | null {
  const s = normalizeSpaces(line);
  if (!s || isPlusVetLabMachinePanelHeaderLine(s)) return null;
  if (/^20\d{2}[./-]\d{1,2}[./-]\d{1,2}\s+\d{1,2}:\d{2}/.test(s) && s.includes('|')) return null;
  if (isPlusVetPatientInfoLine(s)) return null;

  const m = s.match(/^(\S+)\s+(.+)$/);
  if (!m?.[1] || !m[2]) return null;

  const itemName = m[1]; // 원문 그대로. U-* 매핑·메타 드롭은 정규화 단계(route.ts)에서 한다.

  let rest = m[2].trim();
  const refStripped = stripTrailingRefRange(rest);
  const referenceRange = refStripped.ref;
  rest = refStripped.head;
  const { head: afterUnit, unit } = stripTrailingUaUnit(rest);
  const valueText = afterUnit.trim();
  if (!valueText) return null;

  const num = numericFromValueText(valueText);
  const isNumeric = num !== null && /^[<>≤≥]?\s*[-+]?\d/.test(valueText);
  const flag: LabItem['flag'] =
    isNumeric && referenceRange ? computeLabFlag(valueText, referenceRange) : 'normal';

  return { page, rowY: 0, itemName, value: isNumeric ? num : null, valueText, unit, referenceRange, flag, rawRow: s };
}

export function parsePlusVetLabBucketLines(lines: LineIn[], opts?: { forceUrinalysis?: boolean }): LabItem[] {
  const untilTrend: LineIn[] = [];
  for (const row of lines) {
    if (isDiagnosisTrendSectionTitle(row.text)) break;
    // 추출 잔여물(그리스 동형문자·꼬리 대시 등)을 먼저 흡수 → 병합·파싱이 깨끗한 텍스트를 보게 함.
    untilTrend.push({ page: row.page, text: normalizeOcrArtifacts(row.text) });
  }
  const merged = mergeOrphanRefRanges(mergeVerticalLabItems(mergeContinuationRows(untilTrend)));
  const items: LabItem[] = [];
  // UA(요검사) 패널 안에서는 값이 정성/서술이라 전용 파서를 쓰고, 항목을 소변 전용 이름으로 라우팅한다.
  //  date-by-date 그룹핑은 헤더 줄을 떼어가므로(groupLabLinesByDate) forceUrinalysis 로 그룹 전체를 UA 로 본다.
  //  헤더가 줄에 남아 있는 경로(single-pass)에선 아래 detectPlusVetPanelHeader 가 갱신한다.
  let inUA = opts?.forceUrinalysis === true;
  for (const row of merged) {
    const panel = detectPlusVetPanelHeader(row.text);
    if (panel !== null) { inUA = panel; continue; } // 패널 헤더 줄 자체는 항목 아님
    const item = inUA ? parsePlusVetUrinalysisLine(row.text, row.page) : parsePlusVetLabLine(row.text, row.page);
    if (item) items.push(item);
  }
  return items;
}

