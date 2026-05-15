/**
 * eFriends 혈액 표 → DB `result_lab_items` 매핑 (차트 종류 이프렌즈 전용 파이프라인):
 * - `item_name` ← Name 열
 * - `reference_range` ← Reference (DB는 한 컬럼; 이프렌즈는 보통 **가운데 `-`로 Min–Max** 구간. 비어 있거나 `—`만 있으면 null)
 * - `value_text` ← Result (`*` 제거 후 저장; 수치는 공백 정리·콤마 소수 등 정규화)
 * - `unit` ← Unit
 * - `date_time` ← Laboratory date (앵커 줄은 `YYYY-MM-DD` 정규화, `extractLabDateTime`과 동일 키)
 * - `flag` ← 참고구간·숫자값 기반 low/high/normal/unknown
 *
 * 버킷 원문은 디버그용; DB·Lab Examination UI에는 파싱된 행만 저장됩니다.
 */
import type { LabItem } from "@/lib/lab-parser";
import { extractLabDateTime } from "@/lib/text-bucketing/chart-dates";
import { isEfriendsPdfFooterDateTimeLine, isEfriendsPdfFooterPageLine } from "@/lib/text-bucketing/efriends-pdf-noise";

export type EfriendsOrderedLine = { page: number; text: string };

export type EfriendsBucketLine = {
  page: number;
  text: string;
  corrected: boolean;
};

/** 같은 줄: Laboratory date: 2024-01-03 */
const LABORATORY_DATE_SAME_LINE_RE =
  /(?:laboratory|labratory)\s+date\s*:\s*(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/i;

/** 줄만: Laboratory date: (날짜는 다음 줄) */
const LABORATORY_DATE_LABEL_ONLY_RE = /^(?:laboratory|labratory)\s+date\s*:?\s*$/i;

/** 단독 날짜 줄 */
const STANDALONE_YMD_RE = /^(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\s*$/;

/**
 * 차트 본문 방문 줄 `Date: 2026-04-08` (Laboratory date 와 구분).
 * 다른 날짜의 lab 블록이 이어지기 전에 나오며, 이 줄부터 다음 `Laboratory date:` 까지는 lab 버킷에 넣지 않는다.
 */
const EFRIENDS_CHART_VISIT_DATE_LINE_RE =
  /^date\s*:\s*(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/i;

/** 방사선 결과 섹션 — 혈액 lab 표와 무관; lab 버킷 수집을 여기서 끊는다. */
function isEfriendsRadiologyResultSectionLine(t: string): boolean {
  return /\bradiology\s+result\b/i.test(t.trim());
}

/** Lab 날짜 블록 안의 신체검사 서브섹션 제목 (Idexx 표 헤더 직전 한 줄). */
function isEfriendsPhysicalExamSectionTitle(t: string): boolean {
  const s = t.replace(/\s+/g, " ").trim();
  // `\b`는 JS에서 한글 앞뒤에 맞지 않을 수 있어, 제목 끝을 공백/문자열 끝으로만 본다.
  return /^신체검사(?:\s|$|[:\-–—[(])/i.test(s);
}

function isEfriendsCbcPanelTitleLine(t: string): boolean {
  return /\bcbc\b/i.test(t.trim());
}

export type EfriendsLabPhysicalExtract = {
  lab: EfriendsBucketLine[];
  physicalExam: EfriendsBucketLine[];
};

function isEfriendsChartVisitMetaLine(t: string): boolean {
  const s = t.trim();
  if (EFRIENDS_CHART_VISIT_DATE_LINE_RE.test(s)) return true;
  if (/^purpose\s+of\s+visit\s*:/i.test(s)) return true;
  if (/^record\s+user\s*:/i.test(s)) return true;
  return false;
}

function isEfriendsLaboratoryDateMetaLine(text: string): boolean {
  const t = text.trim();
  if (LABORATORY_DATE_SAME_LINE_RE.test(t)) return true;
  if (LABORATORY_DATE_LABEL_ONLY_RE.test(t)) return true;
  if (STANDALONE_YMD_RE.test(t)) return true;
  return false;
}

function pad2(n: string) {
  const x = Number.parseInt(n, 10);
  return Number.isFinite(x) ? String(x).padStart(2, "0") : n.padStart(2, "0");
}

function normalizeLabSessionDate(y: string, m: string, d: string) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** 헤더 조각 줄 (여러 줄로 쪼개진 표 머리글) */
function isLikelyHeaderFragmentLine(t: string): boolean {
  const s = t.trim().toLowerCase();
  if (s === "name" || s === "reference" || s === "result" || s === "unit") return true;
  if (/^result\s+unit$/i.test(t.trim())) return true;
  return false;
}

/**
 * 이어 붙인 문자열이 Name → Reference → Result → Unit 순서를 만족하는지 (한 줄·여러 줄 공통).
 */
export function isEfriendsLabHeaderCombined(combined: string): boolean {
  const t = combined.replace(/\s+/g, " ").trim().toLowerCase();
  if (t.length < 12) return false;
  const iName = t.indexOf("name");
  const iRef = t.indexOf("reference");
  const iRes = t.indexOf("result");
  const iUnit = t.indexOf("unit");
  if (iName < 0 || iRef < 0 || iRes < 0 || iUnit < 0) return false;
  return iName < iRef && iRef < iRes && iRes < iUnit;
}

/**
 * 단일 줄에 붙어 있는 경우 (기존).
 */
export function isEfriendsLabTableHeaderLine(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  return /^name\b/i.test(t) && isEfriendsLabHeaderCombined(t);
}

function inferNumericFlag(value: number | null, referenceRange: string | null): LabItem["flag"] {
  if (value === null) return "unknown";
  const t = referenceRange?.trim() ?? "";
  if (!t || isEfriendsEmptyCell(t)) return "unknown";

  const bounds = parseEfriendsNumericReferenceBounds(t);
  if (bounds) {
    if (value < bounds.min) return "low";
    if (value > bounds.max) return "high";
    return "normal";
  }

  const lt = t.match(/^<\s*(\d+(?:[.,]\d+)?)/);
  if (lt) {
    const max = Number.parseFloat(lt[1].replace(",", "."));
    if (Number.isFinite(max)) {
      if (value > max) return "high";
      return "normal";
    }
  }

  return "unknown";
}

/** Result 셀: EMR에서 이탤릭/강조로 붙는 `*` 제거 후 DB·표시용 문자열 */
function normalizeEfriendsLabValueTextForDb(raw: string): string {
  let s = raw.replace(/\*/g, "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  const compact = s.replace(/\s+/g, "");
  const numericWithSuffix = compact.match(/^([<>]?\d+(?:[.,]\d+)?)(?:[!A-Za-z]+)$/);
  if (numericWithSuffix) {
    s = numericWithSuffix[1] ?? s;
  }
  if (/^\d+,\d+$/.test(s)) {
    s = s.replace(",", ".");
  }
  return s;
}

function normalizeEfriendsAnalyteName(raw: string): string {
  return raw
    .replace(/\s*\([^)]*\)\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildLabItem(
  itemName: string,
  referenceRange: string,
  valueText: string,
  unit: string,
  page: number,
  rowY: number,
  rawRow: string,
): LabItem {
  const valueStored = normalizeEfriendsLabValueTextForDb(valueText);
  const vt = valueStored.replace(/\s+/g, "").replace(",", ".");
  const num = Number.parseFloat(vt.replace(/^</, ""));
  const value = Number.isFinite(num) ? num : null;
  const normalizedItemName = normalizeEfriendsAnalyteName(itemName);
  const refTrim = isEfriendsEmptyCell(referenceRange) ? "" : referenceRange.trim();
  const unitTrim = isEfriendsEmptyCell(unit) ? "" : unit.trim();
  return {
    page,
    rowY,
    itemName: normalizedItemName,
    value,
    valueText: valueStored,
    unit: unitTrim || null,
    referenceRange: refTrim || null,
    flag: inferNumericFlag(value, refTrim || null),
    rawRow,
  };
}

const QUALITATIVE_REF_PLACEHOLDER = "—";

function isEfriendsEmptyCell(s: string): boolean {
  const t = s.trim();
  return !t || /^[—\-–n/a]+$/i.test(t);
}

/**
 * 이프렌즈 Reference: 가운데 `-`/`~` 기준 앞이 Min, 뒤가 Max (날짜·`<100` 형식은 제외).
 * DB에는 `reference_range` 문자열로만 저장하고, flag 계산에만 bounds를 씁니다.
 */
function parseEfriendsNumericReferenceBounds(ref: string): { min: number; max: number } | null {
  const t = ref.trim();
  if (!t || isEfriendsEmptyCell(t)) return null;
  if (/^20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(t)) return null;
  const m = t.match(/(\d+(?:[.,]\d+)?)\s*[-~]\s*(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const min = Number.parseFloat(m[1].replace(",", "."));
  const max = Number.parseFloat(m[2].replace(",", "."));
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return { min, max };
}

function looksLikeEfriendsReferenceLine(s: string): boolean {
  const t = s.trim();
  if (/^20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(t)) return false;
  if (t === "—" || t === "-" || /^n\/?a$/i.test(t)) return true;
  if (/^<\s*\d+[.,]?\d*$/.test(t)) return true;
  if (/^\d+[.,]?\d*\s*[-~]\s*\d+[.,]?\d*/.test(t)) return true;
  if (/^\d+[.,]?\d*\s*[-~]\s*</i.test(t)) return true;
  return false;
}

function looksLikeEfriendsAnalyteName(s: string): boolean {
  const t = s.trim();
  if (!t || t.length > 120) return false;
  if (isEfriendsLabHeaderCombined(t) || isEfriendsLabTableHeaderLine(t)) return false;
  if (looksLikeEfriendsReferenceLine(t)) return false;
  if (LABORATORY_DATE_SAME_LINE_RE.test(t) || LABORATORY_DATE_LABEL_ONLY_RE.test(t)) return false;
  if (STANDALONE_YMD_RE.test(t)) return false;
  if (/^(Catalyst|Procyte)[_/.\s]/i.test(t) && !/[()]/.test(t)) return false;
  return /[A-Za-z가-힣]/.test(t);
}

/** Result+Unit 한 줄 (Idexx 세로 표 하단) */
function parseValueUnitCombinedLine(line: string): { valueText: string; unit: string } | null {
  const t = line.replace(/\s+/g, " ").trim();
  if (!t) return null;

  const qual = t.match(/^(음성|양성|NEG|POS|Normal|Abnormal|TRACE)\/?$/i);
  if (qual) return { valueText: qual[1] ?? t, unit: "—" };

  const m = t.match(/^(\*?\s*<?[\d.,]+(?:\/[\d.,]+)?(?:[!A-Za-z]+)?)\s+(.+)$/);
  if (m) {
    const vt = m[1].trim();
    const u = m[2].trim();
    if (u.length >= 1) return { valueText: vt, unit: u };
  }

  if (/^[\d.,]+(?:[!A-Za-z]+)?$/.test(t)) return { valueText: t, unit: "—" };

  return null;
}

function looksLikeEfriendsUnitCell(t: string): boolean {
  const s = t.trim();
  if (!s || isEfriendsEmptyCell(s)) return true;
  // Prevent next analyte labels like "ALT (PT10)" from being consumed as unit cells.
  if (/\(\s*PT\d+\s*\)$/i.test(s)) return false;
  if (looksLikeEfriendsReferenceLine(s)) return false;
  if (parseValueUnitCombinedLine(s)) return false;
  if (/^[\d.,*<]+$/i.test(s.replace(/^\*/, ""))) return false;
  return /[A-Za-z가-힣%μµ²³/^]/.test(s) || /\/[A-Za-z]/.test(s);
}

function tryParseVerticalThreeLines(
  nameLine: string,
  refLine: string,
  valueLine: string,
  page: number,
  rowY: number,
): LabItem | null {
  if (!looksLikeEfriendsAnalyteName(nameLine)) return null;
  if (!looksLikeEfriendsReferenceLine(refLine)) return null;
  const vu = parseValueUnitCombinedLine(valueLine);
  if (!vu) return null;
  const raw = `${nameLine}\n${refLine}\n${valueLine}`;
  return buildLabItem(nameLine, refLine, vu.valueText, vu.unit, page, rowY, raw);
}

function tryParseVerticalFourLines(
  nameLine: string,
  refLine: string,
  valueLine: string,
  unitLine: string,
  page: number,
  rowY: number,
): LabItem | null {
  if (!looksLikeEfriendsAnalyteName(nameLine)) return null;
  if (!looksLikeEfriendsReferenceLine(refLine)) return null;

  const value = valueLine.trim();
  if (!value || !/^\*?\s*<?[\d.,]+(?:\/[\d.,]+)?(?:[!A-Za-z]+)?$/.test(value)) {
    return null;
  }
  if (!looksLikeEfriendsUnitCell(unitLine)) return null;

  const raw = `${nameLine}\n${refLine}\n${valueLine}\n${unitLine}`;
  return buildLabItem(nameLine, refLine, value, unitLine, page, rowY, raw);
}

function tryParseVerticalTwoLines(nameLine: string, valueLine: string, page: number, rowY: number): LabItem | null {
  if (!looksLikeEfriendsAnalyteName(nameLine)) return null;
  if (looksLikeEfriendsReferenceLine(valueLine)) return null;
  const vu = parseValueUnitCombinedLine(valueLine);
  if (!vu) return null;
  const raw = `${nameLine}\n${valueLine}`;
  return buildLabItem(nameLine, QUALITATIVE_REF_PLACEHOLDER, vu.valueText, vu.unit, page, rowY, raw);
}

function isEfriendsAcceptableReferenceCell(s: string): boolean {
  return isEfriendsEmptyCell(s) || looksLikeEfriendsReferenceLine(s);
}

type EfriendsParsedCells = {
  itemName: string;
  referenceRange: string;
  valueText: string;
  unit: string;
};

/** `\\s{2,}` 로 나뉜 칸 순서: Name … Reference | Result | Unit (빈 칸 허용) */
function assignEfriendsCellsFromGapParts(parts: string[]): EfriendsParsedCells | null {
  const p = parts.map((x) => x.trim());
  if (
    p.length >= 2 &&
    looksLikeEfriendsAnalyteName(p[0] ?? "") &&
    /^\(\s*PT\d+\s*\)$/i.test(p[1] ?? "")
  ) {
    p[0] = `${p[0]} ${p[1]}`.replace(/\s+/g, " ").trim();
    p.splice(1, 1);
  }
  const n = p.length;
  if (n === 0) return null;

  if (n >= 4) {
    const unit = p[n - 1] ?? "";
    const valueText = p[n - 2] ?? "";
    const referenceRange = p[n - 3] ?? "";
    const itemName = normalizeEfriendsAnalyteName(p.slice(0, n - 3).join(" ").trim());
    if (!itemName) return null;
    if (!isEfriendsAcceptableReferenceCell(referenceRange)) return null;
    return { itemName, referenceRange, valueText, unit };
  }

  if (n === 3) {
    const [rawName, b, c] = p;
    const name = normalizeEfriendsAnalyteName(rawName);
    if (!name) return null;
    if (looksLikeEfriendsReferenceLine(b)) {
      if (isEfriendsEmptyCell(c)) {
        return { itemName: name, referenceRange: b, valueText: "", unit: "" };
      }
      const vu = parseValueUnitCombinedLine(c);
      if (vu) {
        return { itemName: name, referenceRange: b, valueText: vu.valueText, unit: vu.unit };
      }
      if (looksLikeEfriendsUnitCell(c)) {
        return { itemName: name, referenceRange: b, valueText: "", unit: c };
      }
      return { itemName: name, referenceRange: b, valueText: c, unit: "" };
    }

    const vuB = parseValueUnitCombinedLine(b);
    if (vuB) {
      let unit = vuB.unit;
      if (!isEfriendsEmptyCell(c) && looksLikeEfriendsUnitCell(c) && unit === "—") {
        unit = c;
      }
      return { itemName: name, referenceRange: "", valueText: vuB.valueText, unit };
    }

    if (!looksLikeEfriendsReferenceLine(b) && !isEfriendsEmptyCell(b) && looksLikeEfriendsUnitCell(c) && !isEfriendsEmptyCell(c)) {
      return { itemName: name, referenceRange: "", valueText: b, unit: c };
    }
    return null;
  }

  if (n === 2) {
    const [rawName, b] = p;
    const name = normalizeEfriendsAnalyteName(rawName);
    if (!name) return null;
    if (looksLikeEfriendsReferenceLine(b)) {
      return { itemName: name, referenceRange: b, valueText: "", unit: "" };
    }
    const vu = parseValueUnitCombinedLine(b);
    if (vu) {
      return { itemName: name, referenceRange: "", valueText: vu.valueText, unit: vu.unit };
    }
    if (!isEfriendsEmptyCell(b) && /^[\d.,*<]/.test(b.replace(/^\*/, ""))) {
      return { itemName: name, referenceRange: "", valueText: b, unit: "" };
    }
    return null;
  }

  // IMPORTANT:
  // n===1 means this row did not have multi-space column gaps.
  // For eFriends OCR this often still contains full one-line columns
  // (Name Reference Result Unit separated by single spaces).
  // So do not finalize as "name-only" here; let token parser decide.
  return null;
}

/**
 * 공백 한 칸으로만 구분된 행에서 이름이 잘리면 뒤 토큰이 Reference/Unit으로 오인될 수 있음.
 * 토큰화 **전에** 줄 전체에 대해 “이건 항목명 한 덩어리” 패턴을 적용한다.
 * (예: `OSM CA`, `OSM CA(idexx)`, `OSM  CA (idexx)` → 항상 하나의 토큰; 뒤에 참고·결과·단위가 있든 없든 동일)
 *
 * 비슷한 다어절·괄호 표기는 정규식을 이 배열에 추가한다.
 */
const EFRIENDS_COMPOUND_ANALYTE_ROW_RES: readonly RegExp[] = [
  /\bOSM\s+CA\s*(?:\([^)]*\))?/gi,
  /\b[A-Z][A-Z0-9/%-]*\s*\(\s*PT\d+\s*\)/gi,
  // "proBNP (V200)", "cPL (V200)" — 이프렌즈 V-코드 접미 항목명
  /\b[A-Za-z]\S*\s*\(\s*V\d+\s*\)/gi,
];

/** 토큰 내부와 충돌하지 않는 프라이빗 유닛 코드 자리표시자 */
const EFW_TOK = { a: "\uE000", b: "\uE001" };

function tokenizeEfriendsLabRowForColumns(compact: string): string[] {
  const originals: string[] = [];
  let masked = compact;
  for (const re of EFRIENDS_COMPOUND_ANALYTE_ROW_RES) {
    masked = masked.replace(re, (full) => {
      const idx = originals.length;
      originals.push(full.replace(/\s+/g, " ").trim());
      return `${EFW_TOK.a}${idx}${EFW_TOK.b}`;
    });
  }
  return masked.split(/\s+/).filter(Boolean).map((t) => {
    const m = t.match(new RegExp(`^${EFW_TOK.a}(\\d+)${EFW_TOK.b}$`));
    if (m) return originals[Number(m[1])] ?? t;
    return t;
  });
}

/**
 * `NUM - NUM` 또는 `NUM ~ NUM` 토큰 세 개를 하나의 range 토큰으로 합친다.
 * `RBC(idexx) 6.34 - 12.0 10.43 M/uL` → `["RBC(idexx)", "6.34 - 12.0", "10.43", "M/uL"]`
 */
function collapseRangeTriplets(tokens: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const a = tokens[i] ?? "";
    const op = tokens[i + 1] ?? "";
    const b = tokens[i + 2] ?? "";
    if (
      (op === "-" || op === "~" || op === "–") &&
      /^\d+(?:[.,]\d+)?$/.test(a) &&
      /^\d+(?:[.,]\d+)?$/.test(b)
    ) {
      out.push(`${a} ${op} ${b}`);
      i += 3;
    } else {
      out.push(a);
      i += 1;
    }
  }
  return out;
}

/** 한 칸 간격으로 붙은 행: 오른쪽에서 Reference 토큰을 찾거나, Name+값+단위만 있는 경우 */
function assignEfriendsCellsFromTokens(tokens: string[]): EfriendsParsedCells | null {
  if (tokens.length < 2) return null;
  if (isEfriendsLabHeaderCombined(tokens.join(" "))) return null;
  const tokens_ = collapseRangeTriplets(tokens);

  for (let i = tokens_.length - 1; i >= 1; i -= 1) {
    const refToken = tokens_[i] ?? "";
    if (!looksLikeEfriendsReferenceLine(refToken)) continue;
    // If any token to the LEFT also looks like a reference, that leftmost one is the real
    // reference — the current candidate is actually a value (e.g. "<50" in "0 - 900 <50").
    if (tokens_.slice(0, i).some((t) => looksLikeEfriendsReferenceLine(t))) continue;
    const itemName = normalizeEfriendsAnalyteName(tokens_.slice(0, i).join(" ").trim());
    if (!itemName) continue;
    const rest = tokens_.slice(i + 1);
    if (rest.length === 0) {
      return { itemName, referenceRange: refToken, valueText: "", unit: "" };
    }
    if (rest.length === 1) {
      const tail = rest[0] ?? "";
      const vu = parseValueUnitCombinedLine(tail);
      if (vu) {
        return { itemName, referenceRange: refToken, valueText: vu.valueText, unit: vu.unit };
      }
      if (looksLikeEfriendsUnitCell(tail)) {
        return { itemName, referenceRange: refToken, valueText: "", unit: tail };
      }
      return { itemName, referenceRange: refToken, valueText: tail, unit: "" };
    }
    const unit = rest[rest.length - 1] ?? "";
    const valueText = rest.slice(0, -1).join(" ").trim();
    return { itemName, referenceRange: refToken, valueText, unit };
  }

  if (tokens_.length >= 3) {
    const unit = tokens_[tokens_.length - 1] ?? "";
    const valueText = tokens_[tokens_.length - 2] ?? "";
    const itemName = normalizeEfriendsAnalyteName(tokens_.slice(0, -2).join(" ").trim());
    if (
      itemName &&
      !looksLikeEfriendsReferenceLine(valueText) &&
      looksLikeEfriendsUnitCell(unit) &&
      !isEfriendsEmptyCell(valueText)
    ) {
      return { itemName, referenceRange: "", valueText, unit };
    }
  }

  // 1-line sparse forms:
  // - [Name] [Reference]
  // - [Name] [Result]
  // - [Name] [Unit]
  if (tokens_.length === 2) {
    const [rawName, b] = tokens_;
    const name = normalizeEfriendsAnalyteName(rawName);
    if (!name) return null;
    if (!looksLikeEfriendsAnalyteName(name)) return null;

    if (looksLikeEfriendsReferenceLine(b)) {
      return { itemName: name, referenceRange: b, valueText: "", unit: "" };
    }

    const vu = parseValueUnitCombinedLine(b);
    if (vu) {
      return { itemName: name, referenceRange: "", valueText: vu.valueText, unit: vu.unit };
    }

    if (looksLikeEfriendsUnitCell(b)) {
      return { itemName: name, referenceRange: "", valueText: "", unit: b };
    }
  }

  return null;
}

/**
 * 한 줄을 Name / Reference / Result / Unit 네 칸으로 나눔.
 * Reference·Result·Unit·조합 중 일부가 빈 칸인 PDF도 허용합니다.
 */
export function parseEfriendsFourColumnRow(line: string, page: number, rowY: number): LabItem | null {
  const rawTrimmed = line.trim();
  const compact = rawTrimmed.replace(/\s+/g, " ").trim();
  if (!compact) return null;
  if (isEfriendsLabTableHeaderLine(compact) || isEfriendsLabHeaderCombined(compact)) return null;
  if (isLikelyHeaderFragmentLine(compact) && compact.split(/\s+/).length <= 2) return null;

  // Keep original spacing for column split (`\\s{2,}`), because compacting first
  // collapses real table gaps and can turn 4-column rows into a single "name" cell.
  const gapParts = rawTrimmed
    .split(/\s{2,}/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const fromGap = assignEfriendsCellsFromGapParts(gapParts);
  if (fromGap) {
    return buildLabItem(
      fromGap.itemName,
      fromGap.referenceRange,
      fromGap.valueText,
      fromGap.unit,
      page,
      rowY,
      line,
    );
  }

  const tokens = tokenizeEfriendsLabRowForColumns(compact);
  const fromTok = assignEfriendsCellsFromTokens(tokens);
  if (fromTok) {
    return buildLabItem(
      fromTok.itemName,
      fromTok.referenceRange,
      fromTok.valueText,
      fromTok.unit,
      page,
      rowY,
      line,
    );
  }

  return null;
}

/**
 * `Name`부터 시작해 다음 몇 줄을 이어 붙여 표 헤더가 완성되는지 본다.
 */
function consumeMultilineTableHeader(
  lines: EfriendsOrderedLine[],
  start: number,
): { endExclusive: number; page: number; joined: string } | null {
  const first = lines[start]?.text.trim() ?? "";
  if (!/^name$/i.test(first) && !isEfriendsLabTableHeaderLine(first)) {
    return null;
  }

  const parts: string[] = [];
  let j = start;
  const maxJ = Math.min(lines.length, start + 10);
  const page = lines[start]?.page ?? 0;

  while (j < maxJ) {
    const t = lines[j].text.trim();
    if (!t) {
      j += 1;
      continue;
    }
    if (LABORATORY_DATE_SAME_LINE_RE.test(t) || LABORATORY_DATE_LABEL_ONLY_RE.test(t)) break;
    const ymd = t.match(STANDALONE_YMD_RE);
    if (ymd && parts.length > 0) break;

    parts.push(t);
    const joined = parts.join(" ");
    if (isEfriendsLabHeaderCombined(joined)) {
      return { endExclusive: j + 1, page, joined };
    }
    j += 1;
  }

  return null;
}

function syntheticFourColumnLine(name: string, value: string) {
  const n = name.trim() || "—";
  const v = value.trim();
  return `${n}    ${QUALITATIVE_REF_PLACEHOLDER}    ${v}    ${QUALITATIVE_REF_PLACEHOLDER}`;
}

/**
 * PDF가 페이지/블록마다 **병원명 단독 줄 → 주소+Tel** 푸터를 다시 넣는 경우가 많음.
 * 주소 줄만 `Tel\)` 패턴으로 끊으면, 그 **바로 앞 병원명**은 lab 데이터로 한 줄 밀려 들어감 → lab 버킷 맨 끝에 병원명이 보임.
 */
function isEfriendsStandaloneClinicFooterNameLine(t: string): boolean {
  const s = t.trim();
  if (s.length < 3 || s.length > 80) return false;
  if (/\(idexx\)|\(v200\)/i.test(s)) return false;
  if (/\d+\s*[-~]\s*\d+/.test(s)) return false;
  if (/[-—]\s*\d/.test(s)) return false;
  if (/(?:동물)?병원$/.test(s) && /[가-힣]/.test(s)) return true;
  return false;
}

/**
 * 페이지마다 반복되는 병원 푸터·진료기록 줄. 예전에는 lab 세션 종료로 썼으나,
 * 같은 `Laboratory date` 안에서 페이지가 넘어가며 이 블록 뒤에 검사 표가 이어질 수 있음.
 */
function isEfriendsLabDataEndNoiseLine(t: string): boolean {
  if (/진료기록[-—]/.test(t)) return true;
  if (isEfriendsStandaloneClinicFooterNameLine(t)) return true;
  if (/(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충청|전라|경상|제주|은평|강서|송파).{0,60}Tel\)/i.test(t)) {
    return true;
  }
  return false;
}

/**
 * 패널/페이지 사이: 반복 병원 헤더, 단독 참고구간(0-200), 방문 메타(Date/Purpose/Record) 등.
 * `(idexx)`/`(v200)`가 있으면 검사 데이터로 본다.
 */
function isEfriendsSkippableBetweenPanelsLine(t: string): boolean {
  const s = t.trim();
  if (!s) return true;
  if (/\(idexx\)|\(v200\)/i.test(s)) return false;
  if (isEfriendsLabDataEndNoiseLine(s)) return true;
  if (isEfriendsEmptyCell(s)) return true;
  if (/^date\s*:/i.test(s)) return true;
  if (/^purpose\s+of\s+visit\s*:/i.test(s)) return true;
  if (/^record\s+user\s*:/i.test(s)) return true;
  if (looksLikeEfriendsReferenceLine(s) && s.length < 56) return true;
  return false;
}

function efriendsFindFirstNonSkippableLineIndex(
  lines: EfriendsOrderedLine[],
  from: number,
  maxScan: number,
): number {
  const end = Math.min(lines.length, from + maxScan);
  for (let k = from; k < end; k += 1) {
    const t = lines[k]?.text.trim() ?? "";
    if (isEfriendsSkippableBetweenPanelsLine(t)) continue;
    return k;
  }
  return -1;
}

/** 페이지 헤더·단독 참고구간 등을 건너뛴 뒤 표 헤더가 오는지 (한글 패널 제목 판별용) */
function isEfriendsLineFollowedByLabTableHeader(lines: EfriendsOrderedLine[], lineIndex: number): boolean {
  const k = efriendsFindFirstNonSkippableLineIndex(lines, lineIndex + 1, 60);
  if (k < 0) return false;
  const t = lines[k]?.text.trim() ?? "";
  if (consumeMultilineTableHeader(lines, k)) return true;
  return isEfriendsLabTableHeaderLine(t) || /^name$/i.test(t);
}

/** 푸터 뒤 lab 재개 — `0-200` 같은 줄은 건너뛰고 본다 */
function efriendsLabResumesAfterFooterNoise(lines: EfriendsOrderedLine[], noiseLineIndex: number): boolean {
  const k = efriendsFindFirstNonSkippableLineIndex(lines, noiseLineIndex + 1, 50);
  if (k < 0) return false;
  const t = lines[k]?.text.trim() ?? "";
  if (LABORATORY_DATE_SAME_LINE_RE.test(t) || LABORATORY_DATE_LABEL_ONLY_RE.test(t)) {
    return true;
  }
  if (consumeMultilineTableHeader(lines, k)) return true;
  if (isEfriendsLabTableHeaderLine(t) || /^name$/i.test(t)) return true;
  if (/\(idexx\)/i.test(t) || /\(v200\)/i.test(t)) return true;
  if (/^Catalyst_/i.test(t) || /^Procyte\b/i.test(t)) return true;
  return false;
}

/**
 * 이프렌즈 혈액 PDF(노이즈 제거 후) 줄만 넘깁니다.
 *
 * - **세션**: `Laboratory date:` (+ 같은 줄 또는 다음 줄 ymd) 마다 하나의 표 구간.
 * - 헤더: `Name` … `Reference` … `Result` … `Unit` (여러 줄 허용). 같은 날짜에 패널이 여러 번 오면 헤더가 반복될 수 있음.
 * - **데이터**: 다음 `Laboratory date`가 나올 때까지. (중간에 다시 `Name` 헤더가 오면 서브표로 헤더 줄만 추가)
 * - **페이지 경계**: 병원명·주소(Tel)·진료기록 푸터는 같은 날짜 세션을 끊지 않고 건너뛴다. 푸터 직후 lab 재개가 없을 때만 세션 종료.
 * - **차트 방문**: `Date: yyyy-mm-dd`(Laboratory date 아님)가 나오면 lab 표가 끝난 것으로 보고 세션을 끊는다. 이후 `Purpose of visit`·`Record User` 등도 버킷에 넣지 않으며, 다음 `Laboratory date:` 부터 다시 lab을 수집한다.
 */
export function extractEfriendsLabAndPhysicalExamBuckets(
  pdfLines: EfriendsOrderedLine[],
): EfriendsLabPhysicalExtract {
  const out: EfriendsBucketLine[] = [];
  const physicalOut: EfriendsBucketLine[] = [];
  let i = 0;
  let pendingDate: string | null = null;
  let pendingLabDateLines: EfriendsBucketLine[] = [];
  let sectionContextLine: string | null = null;
  /** Lines between `Laboratory date:` and the first `Name Reference Result Unit` header.
   *  Panels without a separate header (e.g. CBC in the proper Lab Result section) land here
   *  and are flushed to `out` just before the header so they're not silently dropped. */
  let pendingPreHeaderLines: EfriendsBucketLine[] = [];

  while (i < pdfLines.length) {
    const { text, page } = pdfLines[i];
    const t = text.trim();
    if (!t) {
      i += 1;
      continue;
    }

    if (isEfriendsPdfFooterDateTimeLine(t) || isEfriendsPdfFooterPageLine(t)) {
      i += 1;
      continue;
    }

    const sameLine = t.match(LABORATORY_DATE_SAME_LINE_RE);
    if (sameLine) {
      pendingDate = normalizeLabSessionDate(sameLine[1] ?? "", sameLine[2] ?? "", sameLine[3] ?? "");
      sectionContextLine = null;
      pendingLabDateLines = [{ page, text: t, corrected: false }];
      pendingPreHeaderLines = [];
      i += 1;
      continue;
    }

    if (LABORATORY_DATE_LABEL_ONLY_RE.test(t)) {
      const labelLine: EfriendsBucketLine = { page, text: t, corrected: false };
      i += 1;
      while (i < pdfLines.length && !pdfLines[i].text.trim()) i += 1;
      if (i < pdfLines.length) {
        const nextLine = pdfLines[i];
        const next = nextLine.text.trim();
        const dm = next.match(STANDALONE_YMD_RE);
        if (dm) {
          pendingDate = normalizeLabSessionDate(dm[1] ?? "", dm[2] ?? "", dm[3] ?? "");
          sectionContextLine = null;
          pendingLabDateLines = [
            labelLine,
            { page: nextLine.page, text: next, corrected: false },
          ];
          pendingPreHeaderLines = [];
          i += 1;
          continue;
        }
      }
      continue;
    }

    const headerFromHere = consumeMultilineTableHeader(pdfLines, i);
    const physicalStartHere =
      pendingDate &&
      isEfriendsPhysicalExamSectionTitle(t) &&
      isEfriendsLineFollowedByLabTableHeader(pdfLines, i);
    if ((headerFromHere || physicalStartHere) && pendingDate) {
      if (headerFromHere) {
        const { endExclusive, page: hp, joined } = headerFromHere;
        const anchor = pendingDate;
        out.push({ page: hp, text: anchor, corrected: false });
        for (const labMeta of pendingLabDateLines) {
          out.push(labMeta);
        }
        pendingLabDateLines = [];
        for (const pl of pendingPreHeaderLines) {
          out.push(pl);
        }
        pendingPreHeaderLines = [];
        out.push({ page: hp, text: joined, corrected: false });
        i = endExclusive;
      } else {
        const anchor = pendingDate;
        physicalOut.push({ page, text: anchor, corrected: false });
        for (const labMeta of pendingLabDateLines) {
          physicalOut.push(labMeta);
        }
        pendingLabDateLines = [];
      }

      let collectingPhysicalExam = Boolean(physicalStartHere);
      let sawPhysicalExamHeader = false;
      while (i < pdfLines.length) {
        const inner = pdfLines[i];
        const innerText = inner.text.trim();
        if (!innerText) {
          i += 1;
          continue;
        }

        if (collectingPhysicalExam) {
          if (LABORATORY_DATE_SAME_LINE_RE.test(innerText) || LABORATORY_DATE_LABEL_ONLY_RE.test(innerText)) {
            collectingPhysicalExam = false;
            break;
          }
          if (isEfriendsRadiologyResultSectionLine(innerText)) {
            collectingPhysicalExam = false;
            pendingDate = null;
            pendingLabDateLines = [];
            sectionContextLine = null;
            break;
          }
          if (EFRIENDS_CHART_VISIT_DATE_LINE_RE.test(innerText)) {
            collectingPhysicalExam = false;
            pendingDate = null;
            pendingLabDateLines = [];
            sectionContextLine = null;
            break;
          }
          if (isEfriendsLabDataEndNoiseLine(innerText)) {
            if (efriendsLabResumesAfterFooterNoise(pdfLines, i)) {
              physicalOut.push({ page: inner.page, text: inner.text, corrected: false });
              i += 1;
              continue;
            }
            collectingPhysicalExam = false;
            pendingDate = null;
            pendingLabDateLines = [];
            sectionContextLine = null;
            break;
          }
          if (
            /[가-힣]/.test(innerText) &&
            isEfriendsLineFollowedByLabTableHeader(pdfLines, i) &&
            !isEfriendsPhysicalExamSectionTitle(innerText)
          ) {
            collectingPhysicalExam = false;
            i += 1;
            continue;
          }
          if (isEfriendsCbcPanelTitleLine(innerText) && isEfriendsLineFollowedByLabTableHeader(pdfLines, i)) {
            collectingPhysicalExam = false;
            i += 1;
            continue;
          }
          const physicalSubHeader = consumeMultilineTableHeader(pdfLines, i);
          if (physicalSubHeader) {
            if (sawPhysicalExamHeader) {
              collectingPhysicalExam = false;
              continue;
            }
            sawPhysicalExamHeader = true;
            physicalOut.push({
              page: physicalSubHeader.page,
              text: physicalSubHeader.joined,
              corrected: false,
            });
            i = physicalSubHeader.endExclusive;
            continue;
          }
          physicalOut.push({ page: inner.page, text: inner.text, corrected: false });
          i += 1;
          continue;
        }

        if (LABORATORY_DATE_SAME_LINE_RE.test(innerText) || LABORATORY_DATE_LABEL_ONLY_RE.test(innerText)) {
          break;
        }

        if (isEfriendsRadiologyResultSectionLine(innerText)) {
          pendingDate = null;
          pendingLabDateLines = [];
          sectionContextLine = null;
          break;
        }

        if (EFRIENDS_CHART_VISIT_DATE_LINE_RE.test(innerText)) {
          pendingDate = null;
          pendingLabDateLines = [];
          sectionContextLine = null;
          break;
        }

        if (isEfriendsLabDataEndNoiseLine(innerText)) {
          if (efriendsLabResumesAfterFooterNoise(pdfLines, i)) {
            i += 1;
            continue;
          }
          pendingDate = null;
          pendingLabDateLines = [];
          sectionContextLine = null;
          break;
        }

        const subHeader = consumeMultilineTableHeader(pdfLines, i);
        if (subHeader) {
          out.push({ page: subHeader.page, text: subHeader.joined, corrected: false });
          i = subHeader.endExclusive;
          continue;
        }

        if (/^page\s+\d+\s+of\s+\d+$/i.test(innerText) || /^page\s*:\s*\d+\s*$/i.test(innerText)) {
          i += 1;
          continue;
        }
        if (isEfriendsPdfFooterDateTimeLine(innerText) || isEfriendsPdfFooterPageLine(innerText)) {
          i += 1;
          continue;
        }

        if (/^result$/i.test(innerText)) {
          i += 1;
          while (i < pdfLines.length && !pdfLines[i].text.trim()) i += 1;
          if (i >= pdfLines.length) break;
          const valLine = pdfLines[i].text.trim();
          if (
            valLine &&
            !LABORATORY_DATE_SAME_LINE_RE.test(valLine) &&
            !LABORATORY_DATE_LABEL_ONLY_RE.test(valLine) &&
            !consumeMultilineTableHeader(pdfLines, i)
          ) {
            const title = sectionContextLine ?? "—";
            out.push({
              page: inner.page,
              text: syntheticFourColumnLine(title, valLine),
              corrected: false,
            });
            sectionContextLine = null;
            i += 1;
            continue;
          }
          continue;
        }

        // 패널/서브표 제목 (예: 혈액검사 - Procyte One CBC)이 다음 줄에 Name 헤더로 이어지는 경우 — 검사 행으로 넣지 않음
        if (/[가-힣]/.test(innerText) && isEfriendsLineFollowedByLabTableHeader(pdfLines, i)) {
          if (isEfriendsPhysicalExamSectionTitle(innerText)) {
            collectingPhysicalExam = true;
            physicalOut.push({ page: inner.page, text: inner.text, corrected: false });
            i += 1;
            continue;
          }
          i += 1;
          continue;
        }

        out.push({ page: inner.page, text: innerText, corrected: false });
        i += 1;
      }
      continue;
    }

    if (pendingDate && !isLikelyHeaderFragmentLine(t)) {
      sectionContextLine = t;
      pendingPreHeaderLines.push({ page, text: t, corrected: false });
    }

    i += 1;
  }

  return { lab: out, physicalExam: physicalOut };
}

export function extractEfriendsLabBucketLines(pdfLines: EfriendsOrderedLine[]): EfriendsBucketLine[] {
  return extractEfriendsLabAndPhysicalExamBuckets(pdfLines).lab;
}

function skipPastEfriendsTableHeaderFromBucket(lines: EfriendsBucketLine[], start: number): number {
  const ord = lines as unknown as EfriendsOrderedLine[];
  const mh = consumeMultilineTableHeader(ord, start);
  if (mh) return mh.endExclusive;
  const t = lines[start]?.text.trim() ?? "";
  if (isEfriendsLabTableHeaderLine(t) || isEfriendsLabHeaderCombined(t)) {
    return start + 1;
  }
  return start;
}

/**
 * `PL(idexx)` + 다음 줄 참고구간 + (중간에 페이지 헤더·패널 제목 등) + 표 헤더만 있고 결과는 다음 표 첫 행에 있는 경우.
 * RBC 행 값을 PL에 붙이지 않고, PL은 ref만 두고 빈 result로 한 건 만든 뒤 헤더 다음부터 일반 파싱.
 */
function tryParseEfriendsAnalyteRefWithFollowingTableHeader(
  lines: EfriendsBucketLine[],
  i: number,
  rowY: number,
): { item: LabItem; nextIndexExclusive: number } | null {
  const a = lines[i]?.text.trim() ?? "";
  const b = lines[i + 1]?.text.trim() ?? "";
  if (!a || !b) return null;
  if (a.split(/\s+/).filter(Boolean).length !== 1) return null;
  if (!/\(idexx\)|\(v200\)/i.test(a)) return null;
  if (!looksLikeEfriendsAnalyteName(a)) return null;
  if (!looksLikeEfriendsReferenceLine(b)) return null;

  const headerStart = i + 2;
  const afterHeader = skipPastEfriendsTableHeaderFromBucket(lines, headerStart);
  if (afterHeader <= headerStart) return null;

  const raw = `${a}\n${b}`;
  const item = buildLabItem(a, b, "", "", lines[i].page, rowY, raw);
  return { item, nextIndexExclusive: afterHeader };
}

export function parseEfriendsLabItemsFromBucketLines(lines: EfriendsBucketLine[]): LabItem[] {
  const items: LabItem[] = [];
  let rowY = 0;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const t = line.text.trim();
    if (!t) {
      i += 1;
      continue;
    }
    if (extractLabDateTime(t)) {
      i += 1;
      continue;
    }
    if (isEfriendsLaboratoryDateMetaLine(t)) {
      i += 1;
      continue;
    }
    if (isEfriendsLabTableHeaderLine(t) || isEfriendsLabHeaderCombined(t)) {
      i += 1;
      continue;
    }
    if (isLikelyHeaderFragmentLine(t) && t.split(/\s+/).length <= 2) {
      i += 1;
      continue;
    }
    if (isEfriendsChartVisitMetaLine(t)) {
      i += 1;
      continue;
    }

    if (i + 1 < lines.length) {
      const deferred = tryParseEfriendsAnalyteRefWithFollowingTableHeader(lines, i, rowY);
      if (deferred) {
        items.push(deferred.item);
        rowY += 1;
        i = deferred.nextIndexExclusive;
        continue;
      }
    }

    if (i + 3 < lines.length) {
      const a = lines[i].text.trim();
      const b = lines[i + 1].text.trim();
      const c = lines[i + 2].text.trim();
      const d = lines[i + 3].text.trim();
      const quad = tryParseVerticalFourLines(a, b, c, d, lines[i].page, rowY);
      if (quad) {
        items.push(quad);
        rowY += 1;
        i += 4;
        continue;
      }
    }

    if (i + 2 < lines.length) {
      const a = lines[i].text.trim();
      const b = lines[i + 1].text.trim();
      const c = lines[i + 2].text.trim();
      const triple = tryParseVerticalThreeLines(a, b, c, lines[i].page, rowY);
      if (triple) {
        items.push(triple);
        rowY += 1;
        i += 3;
        continue;
      }
    }

    if (i + 1 < lines.length) {
      const a = lines[i].text.trim();
      const b = lines[i + 1].text.trim();
      const pair = tryParseVerticalTwoLines(a, b, lines[i].page, rowY);
      if (pair) {
        items.push(pair);
        rowY += 1;
        i += 2;
        continue;
      }
    }

    const row = parseEfriendsFourColumnRow(t, line.page, rowY);
    if (row) {
      items.push(row);
      rowY += 1;
    }
    i += 1;
  }
  return items;
}
