/**
 * Parse IntoVet-style vaccination / ectoparasite blocks from the vaccination bucket.
 * assign-buckets는 영문 "Vaccination" 헤더 줄(줄 시작)로 vaccination 버킷을 연다. 버킷 안 한글 줄은 파서가 타입·표 형태로 해석한다.
 */

export type VaccinationRecordType = 'preventive' | 'ectoparasite';

export type ParsedVaccinationRecord = {
  recordType: VaccinationRecordType;
  doseOrder: string;
  productName: string;
  administeredDate: string | null;
  sign: string | null;
};

type LineIn = { text: string };

const DATE_IN_TEXT = /((?:19|20)\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/;

function normalizeDate(raw: string): string | null {
  const m = raw.match(DATE_IN_TEXT);
  if (!m?.[1] || !m[2] || !m[3]) return null;
  const y = m[1];
  const mo = m[2].padStart(2, '0');
  const d = m[3].padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

/** Updates section kind from a title-like line. */
export function inferVaccinationSectionType(line: string): VaccinationRecordType | null {
  const s = line.replace(/\s+/g, ' ').trim();
  if (/외부기생충/.test(s) && s.length < 56) return 'ectoparasite';
  if (/예방접종/.test(s) && s.length < 48) return 'preventive';
  if (/\bvaccination\b/i.test(s) && s.length < 44) return 'preventive';
  if (/^접종\s*내역/.test(s)) return 'preventive';
  if (s === '접종') return 'preventive';
  return null;
}

function isChasuHeader(h: string) {
  return /^차수\s*$/.test(h.trim());
}

function isNameHeader(h: string) {
  const t = h.trim();
  return /^name\s*$/i.test(t) || /^이름\s*$/.test(t);
}

function isDateHeader(h: string) {
  const t = h.trim();
  return /^date\s*$/i.test(t) || /^날짜\s*$/.test(t);
}

function isSignHeader(h: string) {
  return /^sign\s*$/i.test(h.trim());
}

function isDoseCell(s: string) {
  const t = s.trim();
  return /^\d+$/.test(t) || /^\d+\s*차$/.test(t);
}

/**
 * Vertical header: 차수 / Name|이름 / Date|날짜 / [Sign] then N × (3 or 4) data lines.
 * Sign column value is skipped (staff name); DB `sign` stays null unless we add real signatures later.
 */
function consumeVerticalTable(
  lines: LineIn[],
  start: number,
  recordType: VaccinationRecordType,
): { records: ParsedVaccinationRecord[]; next: number } {
  const n = lines.length;
  if (start + 2 >= n) return { records: [], next: start };

  const l0 = lines[start].text.trim();
  const l1 = lines[start + 1].text.trim();
  const l2 = lines[start + 2].text.trim();
  if (!isChasuHeader(l0) || !isNameHeader(l1) || !isDateHeader(l2)) {
    return { records: [], next: start };
  }

  let idx = start + 3;
  let rowWidth = 3;
  if (idx < n && isSignHeader(lines[idx].text.trim())) {
    idx += 1;
    rowWidth = 4;
  }

  const out: ParsedVaccinationRecord[] = [];
  while (idx + 2 < n) {
    const dose = lines[idx].text.trim();
    const name = lines[idx + 1].text.trim();
    const dateRaw = lines[idx + 2].text.trim();

    if (isChasuHeader(dose) && isNameHeader(name)) break;
    const t = inferVaccinationSectionType(dose);
    if (t && dose.length < 40) break;

    if (!isDoseCell(dose)) break;
    const dateNorm = normalizeDate(dateRaw);
    if (!dateNorm) break;

    out.push({
      recordType,
      doseOrder: dose.replace(/\s*차$/, '').trim(),
      productName: name,
      administeredDate: dateNorm,
      sign: null,
    });
    idx += rowWidth;
  }

  if (out.length === 0) return { records: [], next: start };
  return { records: out, next: idx };
}

function tryHorizontalRow(text: string, recordType: VaccinationRecordType): ParsedVaccinationRecord | null {
  const m = text.match(/^(\d+)\s+(.+?)\s+((?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2})(?:\s+(.+))?$/);
  if (!m?.[1] || !m[2] || !m[3]) return null;
  const tail = m[4]?.trim();
  if (tail && /^차수$/i.test(tail)) return null;
  return {
    recordType,
    doseOrder: m[1],
    productName: m[2].trim(),
    administeredDate: normalizeDate(m[3]),
    sign: null,
  };
}

export function parseVaccinationRecordsFromBucketLines(lines: Array<{ text: string }>): ParsedVaccinationRecord[] {
  const trimmed: LineIn[] = lines
    .map((l) => ({ text: l.text.replace(/\s+/g, ' ').trim() }))
    .filter((l) => l.text.length > 0);

  const out: ParsedVaccinationRecord[] = [];
  let i = 0;
  let recordType: VaccinationRecordType = 'preventive';

  while (i < trimmed.length) {
    const t = trimmed[i].text;
    const inferred = inferVaccinationSectionType(t);
    if (inferred) {
      recordType = inferred;
      i += 1;
      continue;
    }
    if (/^next\s*date\s*:/i.test(t)) {
      i += 1;
      continue;
    }

    const vert = consumeVerticalTable(trimmed, i, recordType);
    if (vert.records.length > 0) {
      out.push(...vert.records);
      i = vert.next;
      continue;
    }

    const hor = tryHorizontalRow(t, recordType);
    if (hor) {
      out.push(hor);
      i += 1;
      continue;
    }

    i += 1;
  }

  return out;
}
