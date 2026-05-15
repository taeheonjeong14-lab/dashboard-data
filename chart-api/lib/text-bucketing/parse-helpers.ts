/**
 * Parser helper functions extracted from vet-report's route.ts.
 * These are pure parsing utilities with no HTTP/DB dependencies.
 */

import { parsePlusVetLabBucketLines } from '@/lib/text-bucketing/plusvet-lab-parse';
import { parseEfriendsLabItemsFromBucketLines } from '@/lib/text-bucketing/efriends-lab-extract';
import { parsePlusVetPlanRows } from '@/lib/text-bucketing/plusvet-plan-parse';
import {
  isEfriendsPdfFooterDateTimeLine,
  isEfriendsPdfFooterPageLine,
  isEfriendsRepeatingPdfHeaderLine,
} from '@/lib/text-bucketing/efriends-pdf-noise';
import type { ChartKind } from '@/lib/text-bucketing/chart-kind';
import {
  extractChartBodyDateKey,
  extractEfriendsVisitDateKey,
  extractLabDateTime,
} from '@/lib/text-bucketing/chart-dates';
import { normalizeBasicInfoSpeciesBreed } from '@/lib/basic-info-normalization';
import type { LabItem } from '@/lib/lab-parser';

export type OrderedLine = { page: number; text: string };
export type BucketedLine = {
  page: number;
  text: string;
  corrected: boolean;
  originalText?: string;
};

export type ChartBodyByDateGroup = {
  dateTime: string;
  pages: number[];
  bodyText: string;
  planText: string;
  lineCount: number;
  planDetected: boolean;
};

export type LabByDateGroup = {
  dateTime: string;
  pages: number[];
  text: string;
  lineCount: number;
};

export type LabByDateLinesGroup = {
  dateTime: string;
  lines: BucketedLine[];
};

export type ParsedBasicInfo = {
  hospitalName: string | null;
  ownerName: string | null;
  patientName: string | null;
  species: string | null;
  breed: string | null;
  birth: string | null;
  sex: string | null;
};

export type ParsedVitalRow = {
  dateTime: string;
  weight: string | null;
  temperature: string | null;
  respiratoryRate: string | null;
  heartRate: string | null;
  bpSystolic: string | null;
  bpDiastolic: string | null;
  rawText: string;
};

export type ParsedPhysicalExamItem = {
  dateTime: string;
  itemName: string;
  referenceRange: string | null;
  valueText: string;
  unit: string | null;
  rawText: string;
};

export type ParsedPlanRow = {
  code: string;
  treatmentPrescription: string;
  qty: string;
  unit: string;
  day: string;
  total: string;
  route: string;
  signId: string;
  raw: string;
};

// ─── Noise cleaning ──────────────────────────────────────────────────────────

export function cleanNoise(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (/^printed\s*:/i.test(trimmed)) return null;
  if (/^page\s+\d+\s+of\s+\d+$/i.test(trimmed)) return null;
  if (/^page\s*:\s*\d+\s*$/i.test(trimmed)) return null;
  return trimmed;
}

export function orderedLinesFromPastedChartText(raw: string, chartKind?: ChartKind): OrderedLine[] {
  const out: OrderedLine[] = [];
  for (const part of raw.split(/\r?\n/)) {
    let cleaned = cleanNoise(part);
    if (chartKind === 'efriends' && cleaned) {
      if (isEfriendsPdfFooterDateTimeLine(cleaned)) cleaned = null;
      if (cleaned && isEfriendsPdfFooterPageLine(cleaned)) cleaned = null;
      if (cleaned && isEfriendsRepeatingPdfHeaderLine(cleaned)) cleaned = null;
    }
    if (cleaned) out.push({ page: 0, text: cleaned });
  }
  return out;
}

// ─── Basic info ───────────────────────────────────────────────────────────────

export function normalizeBasicInfoSex(value: string | null): string | null {
  if (!value) return null;
  const t = value.trim();

  const neuterMaleEf =
    /\bc[\s.．·\/]*male\b/i.test(t) ||
    /\(\s*중남\s*\)/.test(t) ||
    /（\s*중남\s*）/.test(t) ||
    /^중남$/i.test(t) ||
    (/\b중남\b/i.test(t) && /\bmale\b/i.test(t));
  const neuterFemaleEf =
    /\bs[\s.．·\/]*female\b/i.test(t) ||
    /\(\s*중여\s*\)/.test(t) ||
    /（\s*중여\s*）/.test(t) ||
    /^중여$/i.test(t) ||
    (/\b중여\b/i.test(t) && /\bfemale\b/i.test(t));
  if (neuterMaleEf) return '수컷(중성화)';
  if (neuterFemaleEf) return '암컷(중성화)';

  if (/male\s*[（(]\s*남\s*[）)]/i.test(t)) return '수컷';
  if (/female\s*[（(]\s*여\s*[）)]/i.test(t)) return '암컷';

  const isNeuter = /neut|spay|castrat|\bfs\b|\bmn\b|중성/i.test(t);
  const isFemale = /(female|암컷|암|\bf\b)/i.test(t);
  const isMale = /(male|수컷|수|\bm\b)/i.test(t) && !isFemale;

  if (isNeuter && isFemale) return '암컷(중성화)';
  if (isNeuter && isMale) return '수컷(중성화)';
  if (isFemale) return '암컷';
  if (isMale) return '수컷';
  return t;
}

function extractEfriendsSexRaw(filtered: string[], fullBlock: string): string | null {
  const skipValue = (v: string) =>
    !v ||
    /^(information|client|patient|owner|species|breed|birth|dob|sex|gender)$/i.test(v);

  const linePatterns: RegExp[] = [
    /^성\s*[:：﹕∶]\s*(.+)$/i,
    /^(?:sex|gender|성별|sex\s*[/／]\s*gender)\s*[:：﹕∶]?\s*(.+)$/i,
    /^(?:환자\s*성별|pet\s*sex|animal\s*sex)\s*[:：﹕∶]?\s*(.+)$/i,
    /^(?:sex|gender|성별)\s+(.+)$/i,
  ];
  for (const line of filtered) {
    for (const re of linePatterns) {
      const m = line.match(re);
      if (!m?.[1]) continue;
      const v = m[1].trim();
      if (skipValue(v)) continue;
      return v;
    }
  }

  for (let i = 0; i < filtered.length - 1; i++) {
    if (
      !/^(?:sex|gender|성별|성|환자\s*성별|sex\s*[/／]\s*gender)\s*[:：﹕∶]?\s*$/i.test(filtered[i])
    ) {
      continue;
    }
    const next = filtered[i + 1].trim();
    if (skipValue(next)) continue;
    if (/^(patient|owner|species|breed|birth|dob|나이|종|품종|축종)/i.test(next)) continue;
    return next;
  }

  const earlyFlat = filtered.slice(0, 50).join('\n');
  const blockMatch = earlyFlat.match(
    /(?:^|\n)\s*(?:sex|gender|성별|성|환자\s*성별)\s*[:：﹕∶]?\s*([^\n\r]+)/im,
  );
  if (blockMatch?.[1]) {
    const v = blockMatch[1].trim();
    if (!skipValue(v)) return v;
  }

  const head = earlyFlat.slice(0, 3000);
  const token = head.match(
    /\b(C[\s.．·\/]*male(?:（[^）]*）|\([^\)]*\))?|S[\s.．·\/]*female(?:（[^）]*）|\([^\)]*\))?)/i,
  );
  if (token?.[1] && !skipValue(token[1].trim())) return token[1].trim();

  const mf = head.match(/\b(Male\s*[（(][^）)]*[）)]|Female\s*[（(][^）)]*[）)])\b/i);
  if (mf?.[1]) return mf[1].trim();

  return null;
}

const PLUSVET_HOSPITAL_LINE_HINT = /동물병원|동물메디컬센터|동물의료센터/;

const PLUSVET_BASIC_INFO_STOP_LABELS = [
  '진단 검사 결과',
  '동물 등록 번호',
  '축종/품종',
  '보호자 성함',
  '연락처',
  '동물명',
  '나이',
  '주소',
  '성별',
];

const PLUSVET_OWNER_VALUE_EXTRA_STOPS = [
  '경기도', '강원특별자치도', '강원도', '서울특별시', '서울시', '인천광역시', '인천시',
  '부산광역시', '부산시', '대구광역시', '대구시', '대전광역시', '대전시', '광주광역시', '광주시',
  '울산광역시', '울산시', '세종특별자치시', '세종시', '제주특별자치도', '제주시',
  '충청북도', '충청남도', '전북특별자치도', '전라북도', '전라남도', '경상북도', '경상남도',
];

function escapeRegExpLiteral(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parsePlusVetBasicInfoFromText(block: string): ParsedBasicInfo {
  const rawLines = block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  let hospitalName: string | null = null;
  for (const line of rawLines) {
    if (PLUSVET_HOSPITAL_LINE_HINT.test(line)) {
      const stripped = line.replace(/^진단\s*검사\s*결과\s*/i, '').trim();
      hospitalName = stripped || line;
      break;
    }
  }

  const flat = rawLines.join(' ').replace(/\s+/g, ' ').trim();
  const stopAlt = [...PLUSVET_BASIC_INFO_STOP_LABELS].sort((a, b) => b.length - a.length).map(escapeRegExpLiteral).join('|');
  const ownerStopAlt = [...PLUSVET_BASIC_INFO_STOP_LABELS, ...PLUSVET_OWNER_VALUE_EXTRA_STOPS]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExpLiteral)
    .join('|');

  const pickField = (labelSource: string): string | null => {
    const re = new RegExp(
      `${labelSource}\\s*[:：]?\\s*(.+?)(?=\\s+(?:${stopAlt})(?:\\s|$)|$)`,
      'is',
    );
    const m = flat.match(re);
    const v = m?.[1]?.trim();
    return v || null;
  };

  const pickOwnerName = (): string | null => {
    const re = new RegExp(
      `보호자\\s*성함\\s*[:：]?\\s*(.+?)(?=\\s+(?:${ownerStopAlt})(?:\\s|$)|$)`,
      'is',
    );
    const m = flat.match(re);
    const v = m?.[1]?.trim();
    return v || null;
  };

  const ownerName = pickOwnerName();
  const patientName = pickField('동물명');
  const speciesBreedRaw = pickField('축종\\s*/\\s*품종');
  let species: string | null = null;
  let breed: string | null = null;
  if (speciesBreedRaw) {
    const idx = speciesBreedRaw.indexOf('/');
    if (idx >= 0) {
      species = speciesBreedRaw.slice(0, idx).trim() || null;
      breed = speciesBreedRaw.slice(idx + 1).trim() || null;
    } else {
      species = speciesBreedRaw;
    }
  }

  const birth = pickField('나이');
  const sex = normalizeBasicInfoSex(pickField('성별'));

  return { hospitalName, ownerName, patientName, species, breed, birth, sex };
}

function parseEfriendsBasicInfoFromText(block: string): ParsedBasicInfo {
  const lines = block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const filtered = lines.filter((line) => !/^client\s*&\s*patient\s+information$/i.test(line));
  const pickByLabel = (patterns: RegExp[]): string | null => {
    for (const line of filtered) {
      for (const re of patterns) {
        const m = line.match(re);
        if (!m?.[1]) continue;
        const v = m[1].trim();
        if (!v) continue;
        if (/^(information|client|patient|owner|species|breed|birth|dob|sex)$/i.test(v)) continue;
        return v;
      }
    }
    return null;
  };
  const normalizeCompactDate = (value: string): string | null => {
    const t = value.trim();
    const compact = t.match(/\b(19\d{2}|20\d{2})(0[1-9]|1[0-2])([0-2]\d|3[01])\b/);
    if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
    const ymd = t.match(/\b(19\d{2}|20\d{2})[./-](\d{1,2})[./-](\d{1,2})\b/);
    if (!ymd) return null;
    const m = String(Number.parseInt(ymd[2] ?? '0', 10)).padStart(2, '0');
    const d = String(Number.parseInt(ymd[3] ?? '0', 10)).padStart(2, '0');
    return `${ymd[1]}-${m}-${d}`;
  };
  const speciesRaw = pickByLabel([
    /^(?:species|종)\s*[:：]\s*(.+)$/i,
    /^(?:축종)\s*[:：]\s*(.+)$/i,
  ]);
  const breedRaw = pickByLabel([
    /^(?:breed|품종)\s*[:：]\s*(.+)$/i,
    /^(?:상세품종)\s*[:：]\s*(.+)$/i,
  ]);
  const sexRaw = extractEfriendsSexRaw(filtered, block);
  const birthRaw = pickByLabel([
    /^(?:birth|dob|생년월일|생일)\s*[:：]\s*(.+)$/i,
    /^(?:환자\s*생일)\s*[:：]\s*(.+)$/i,
  ]);

  return {
    hospitalName: null,
    ownerName: pickByLabel([/^(?:client|owner|보호자)\s*[:：]\s*(.+)$/i]),
    patientName: pickByLabel([/^(?:patient|환자)\s*[:：]\s*(.+)$/i]),
    species: speciesRaw,
    breed: breedRaw,
    birth: birthRaw ? normalizeCompactDate(birthRaw) ?? birthRaw : null,
    sex: normalizeBasicInfoSex(sexRaw),
  };
}

export function parseBasicInfoFromText(
  fullText: string,
  chartKind: ChartKind = 'intovet',
  basicInfoLines?: BucketedLine[],
): ParsedBasicInfo {
  const withNormalizedSpeciesBreed = (info: ParsedBasicInfo): ParsedBasicInfo => {
    const normalized = normalizeBasicInfoSpeciesBreed({
      species: info.species,
      breed: info.breed,
    });
    return { ...info, species: normalized.species, breed: normalized.breed };
  };

  if (chartKind === 'plusvet') {
    const block =
      basicInfoLines && basicInfoLines.length > 0
        ? basicInfoLines.map((l) => l.text).join('\n')
        : fullText;
    return withNormalizedSpeciesBreed(parsePlusVetBasicInfoFromText(block));
  }

  if (chartKind === 'efriends') {
    return withNormalizedSpeciesBreed(parseEfriendsBasicInfoFromText(fullText));
  }

  const lines = fullText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const labelTokens = [
    'Client No', 'Client', 'Owner', 'Patient', 'Species', 'Breed', 'Birth', 'Sex',
    'Address', 'Tel', 'RFID', 'Color',
    '보호자명', '보호자', '환자명', '환자', '품종', '상세품종', '생년월일', '생일', '성별',
  ];
  const escapedLabelAlternation = labelTokens
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');

  const pick = (keys: string[]) => {
    for (const key of keys) {
      const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(
        `${escapedKey}\\s*[:：]\\s*(.+?)(?=\\s+(?:${escapedLabelAlternation})\\s*[:：]|\\n|$)`,
        'i',
      );
      const match = fullText.match(regex);
      if (match?.[1]) {
        const value = match[1].trim();
        if (value) return value;
      }
    }
    return null;
  };

  const result: ParsedBasicInfo = {
    hospitalName: null,
    ownerName: pick(['client', 'owner', '보호자', '보호자명']),
    patientName: pick(['patient', '환자', '환자명']),
    species: pick(['species', '종', '품종']),
    breed: pick(['breed', '상세품종']),
    birth: pick(['birth', 'dob', '생년월일', '생일', '환자 생일']),
    sex: normalizeBasicInfoSex(pick(['sex', 'gender', '성별', '환자 성별'])),
  };

  result.hospitalName = lines[0] ?? null;

  return withNormalizedSpeciesBreed(result);
}

// ─── Chart body grouping ──────────────────────────────────────────────────────

function findEfriendsChartBodyContentStart(lines: BucketedLine[]): number {
  for (let i = 0; i < lines.length; i += 1) {
    const cur = lines[i].text.replace(/\s+/g, ' ').trim();
    if (!/purpose\s+of\s+visit\s*:/i.test(cur)) continue;
    for (let j = Math.max(0, i - 4); j < i; j += 1) {
      const t = lines[j].text.replace(/\s+/g, ' ').trim();
      if (/^date\s*:\s*20\d{2}[./-]\d{1,2}[./-]\d{1,2}\b/i.test(t)) return j;
    }
  }
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].text.replace(/\s+/g, ' ').trim();
    if (!/^date\s*:\s*20\d{2}[./-]\d{1,2}[./-]\d{1,2}\b/i.test(t)) continue;
    const window = lines.slice(i, Math.min(lines.length, i + 6)).map((l) => l.text).join('\n');
    if (/purpose\s+of\s+visit\s*:/i.test(window)) return i;
  }
  return 0;
}

export function groupChartBodyByDate(lines: BucketedLine[], chartKind: ChartKind): ChartBodyByDateGroup[] {
  const linesToGroup =
    chartKind === 'efriends' && lines.length > 0
      ? lines.slice(findEfriendsChartBodyContentStart(lines))
      : lines;

  const groups = new Map<string, BucketedLine[]>();
  let currentKey = 'unknown';

  for (const line of linesToGroup) {
    const dateTime =
      chartKind === 'efriends'
        ? extractEfriendsVisitDateKey(line.text) ?? extractChartBodyDateKey(line.text, chartKind)
        : extractChartBodyDateKey(line.text, chartKind);
    if (dateTime) {
      currentKey = dateTime;
      if (!groups.has(currentKey)) {
        groups.set(currentKey, []);
      }
      if (chartKind === 'efriends') {
        const list = groups.get(currentKey) ?? [];
        list.push(line);
        groups.set(currentKey, list);
      }
      continue;
    }
    const list = groups.get(currentKey) ?? [];
    list.push(line);
    groups.set(currentKey, list);
  }

  return [...groups.entries()]
    .filter(([dateTime, groupLines]) => dateTime !== 'unknown' || groupLines.length > 0)
    .map(([dateTime, groupLines]) => {
      const texts = groupLines.map((line) => line.text);
      const planStart = findPlanStartIndex(texts, chartKind);
      const bodyText =
        planStart >= 0 ? texts.slice(0, planStart).join('\n').trim() : texts.join('\n').trim();
      const planText = planStart >= 0 ? texts.slice(planStart).join('\n').trim() : '';

      return {
        dateTime,
        pages: [...new Set(groupLines.map((line) => line.page))].sort((a, b) => a - b),
        bodyText,
        planText,
        lineCount: groupLines.length,
        planDetected: planStart >= 0,
      };
    });
}

// ─── Lab grouping ─────────────────────────────────────────────────────────────

export function groupLabByDate(lines: BucketedLine[]): LabByDateGroup[] {
  const grouped = groupLabLinesByDate(lines);
  return grouped.map((group) => ({
    dateTime: group.dateTime,
    pages: [...new Set(group.lines.map((line) => line.page))].sort((a, b) => a - b),
    text: group.lines.map((line) => line.text).join('\n').trim(),
    lineCount: group.lines.length,
  }));
}

export function groupLabLinesByDate(lines: BucketedLine[]): LabByDateLinesGroup[] {
  const groups = new Map<string, BucketedLine[]>();
  let currentKey = 'unknown';

  for (const line of lines) {
    const dateTime = extractLabDateTime(line.text);
    if (dateTime) {
      currentKey = dateTime;
      if (!groups.has(currentKey)) {
        groups.set(currentKey, []);
      }
      continue;
    }
    const list = groups.get(currentKey) ?? [];
    list.push(line);
    groups.set(currentKey, list);
  }

  return [...groups.entries()].map(([dateTime, groupLines]) => ({
    dateTime,
    lines: groupLines,
  }));
}

// ─── Utility helpers ──────────────────────────────────────────────────────────

export function normalizeForContains(text: string) {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function parseDateTimeLoose(text: string): Date | null {
  const m = text.match(
    /(20\d{2})[./-](\d{1,2})[./-](\d{1,2})\s+([0-2]?\d):([0-5]\d)(?::([0-5]\d))?/,
  );
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = m[6] ? Number(m[6]) : 0;
  const d = new Date(year, month, day, hour, minute, second);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeVitalValue(raw: string | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t || t === '-' || t === '—') return null;
  if (/^0(?:[.]0+)?$/.test(t)) return null;
  return t;
}

function normalizeDateOnly(dateText: string): string | null {
  const m = dateText.match(/^(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (!m) return null;
  return `${m[1]}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[3])).padStart(2, '0')}`;
}

function isPhysicalExamHeaderLine(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim().toLowerCase();
  return (
    t === 'name' ||
    t === 'reference' ||
    t === 'result' ||
    t === 'unit' ||
    t === 'result unit' ||
    t === 'name reference result unit'
  );
}

function looksLikePhysicalExamReference(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/^<?\d+(?:[.,]\d+)?\s*[-~]\s*<?\d+(?:[.,]\d+)?$/.test(t)) return true;
  if (/^\d+\s*-\s*\d+$/.test(t)) return true;
  return false;
}

function splitPhysicalExamValueUnit(raw: string): { valueText: string; unit: string | null } {
  const t = raw.replace(/\s+/g, ' ').trim();
  const m = t.match(/^(.+?)\s+([A-Za-z%/]+|kg|g|mg\/dL|도|회\/분|bpm)$/i);
  if (m) return { valueText: (m[1] ?? '').trim(), unit: (m[2] ?? '').trim() || null };
  return { valueText: t, unit: null };
}

function isLikelyPhysicalExamValueOnlyLine(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return true;
  if (looksLikePhysicalExamReference(t)) return true;
  if (/^(?:<|>)?\s*\d+(?:[.,]\d+)?(?:\s*(?:kg|g|mg\/dL|도|회\/분|bpm))?$/i.test(t)) return true;
  if (/^(?:nrf|pink|good|fair|poor|normal|abnormal)$/i.test(t)) return true;
  return false;
}

export function parseEfriendsPhysicalExamItemsFromVitalsLines(vitalsLines: OrderedLine[]): ParsedPhysicalExamItem[] {
  const out: ParsedPhysicalExamItem[] = [];
  let currentDate: string | null = null;
  let collecting = false;
  let i = 0;
  while (i < vitalsLines.length) {
    const text = (vitalsLines[i]?.text ?? '').trim();
    if (!text) { i += 1; continue; }
    const dt = extractLabDateTime(text);
    if (dt) { currentDate = dt.slice(0, 10); i += 1; continue; }
    const dateOnly = normalizeDateOnly(text);
    if (dateOnly) { currentDate = dateOnly; i += 1; continue; }
    if (/^신체검사(?:\s|$|[:\-–—[(])/i.test(text)) { collecting = true; i += 1; continue; }
    if (!collecting) { i += 1; continue; }
    if (/cbc/i.test(text)) { collecting = false; i += 1; continue; }
    if (isPhysicalExamHeaderLine(text)) { i += 1; continue; }
    if (/^(laboratory|labratory)\s+date\s*:/i.test(text)) { collecting = false; i += 1; continue; }
    if (isLikelyPhysicalExamValueOnlyLine(text)) { i += 1; continue; }

    const itemName = text;
    const next = (vitalsLines[i + 1]?.text ?? '').trim();
    if (!next || isPhysicalExamHeaderLine(next)) { i += 1; continue; }
    const next2 = (vitalsLines[i + 2]?.text ?? '').trim();
    let referenceRange: string | null = null;
    let valueLine = next;
    let consumed = 2;
    if (looksLikePhysicalExamReference(next) && next2 && !isPhysicalExamHeaderLine(next2)) {
      referenceRange = next;
      valueLine = next2;
      consumed = 3;
    }
    const { valueText, unit } = splitPhysicalExamValueUnit(valueLine);
    if (!valueText) { i += 1; continue; }
    out.push({
      dateTime: currentDate ? `${currentDate}T00:00:00` : 'unknown',
      itemName,
      referenceRange,
      valueText,
      unit,
      rawText: [itemName, referenceRange, `${valueText}${unit ? ` ${unit}` : ''}`].filter(Boolean).join(' '),
    });
    i += consumed;
  }
  return out.filter((x) => x.dateTime !== 'unknown');
}

export function mergeVitalsWithPhysicalExamItems(
  base: ParsedVitalRow[],
  items: ParsedPhysicalExamItem[],
): ParsedVitalRow[] {
  const merged = new Map(base.map((row) => [row.dateTime, { ...row }]));
  const byDate = new Map<string, ParsedPhysicalExamItem[]>();
  for (const item of items) {
    const list = byDate.get(item.dateTime) ?? [];
    list.push(item);
    byDate.set(item.dateTime, list);
  }

  const numeric = (v: string) => {
    const m = v.replace(',', '.').match(/[-+]?\d+(?:\.\d+)?/);
    return m?.[0] ?? null;
  };

  for (const [dateTime, list] of byDate) {
    const row =
      merged.get(dateTime) ??
      ({
        dateTime,
        weight: null,
        temperature: null,
        respiratoryRate: null,
        heartRate: null,
        bpSystolic: null,
        bpDiastolic: null,
        rawText: '',
      } satisfies ParsedVitalRow);

    for (const it of list) {
      const name = it.itemName.replace(/\s+/g, '');
      if (!row.weight && /체중/.test(name)) row.weight = numeric(it.valueText) ?? it.valueText;
      if (!row.temperature && /체온/.test(name)) row.temperature = numeric(it.valueText) ?? it.valueText;
      if (!row.heartRate && /(pr|심박)/i.test(it.itemName)) row.heartRate = numeric(it.valueText) ?? it.valueText;
      if (!row.respiratoryRate && /(rr|호흡)/i.test(it.itemName)) row.respiratoryRate = numeric(it.valueText) ?? it.valueText;
      if (!row.rawText.includes(it.rawText)) {
        row.rawText = row.rawText ? `${row.rawText} | ${it.rawText}` : it.rawText;
      }
    }
    merged.set(dateTime, row);
  }

  return [...merged.values()].sort((a, b) => a.dateTime.localeCompare(b.dateTime));
}

export function parseVitalsFromLines(lines: OrderedLine[], chartKind: ChartKind): ParsedVitalRow[] {
  const values: ParsedVitalRow[] = [];
  const start = lines.findIndex((line) =>
    /일시/.test(line.text) &&
    /체중/.test(line.text) &&
    /체온/.test(line.text) &&
    /호흡수/.test(line.text) &&
    /심박수/.test(line.text) &&
    /혈압\(수축\)/.test(line.text) &&
    /혈압\(이완\)/.test(line.text),
  );
  if (start < 0) return values;

  const vitalsStopPattern =
    chartKind === 'intovet'
      ? /(진단\s*검사\s*결과|진단\s*결과\s*추이|plan|subjective|objective|vaccination|lab examination)/i
      : /(진단\s*검사|진단\s*검사\s*결과|진단\s*결과\s*추이|접종\s*내역|접종|plan|subjective|objective|vaccination|lab examination|임상\s*병리|검체\s*검사)/i;

  for (let i = start + 1; i < lines.length; i += 1) {
    const text = lines[i].text.trim();
    if (!text) continue;
    if (/^--\s*\d+\s+of\s+\d+\s*--$/i.test(text)) continue;
    if (vitalsStopPattern.test(text)) break;

    const m = text.match(/^(20\d{2}[./-]\d{1,2}[./-]\d{1,2}\s+[0-2]?\d:[0-5]\d)\s+(.+)$/);
    if (!m) continue;

    const dateTime = m[1].trim();
    const rest = m[2].trim();
    const parts = rest.split(/\s+/).filter(Boolean);
    if (parts.length < 6) continue;

    values.push({
      dateTime,
      weight: normalizeVitalValue(parts[0]),
      temperature: normalizeVitalValue(parts[1]),
      respiratoryRate: normalizeVitalValue(parts[2]),
      heartRate: normalizeVitalValue(parts[3]),
      bpSystolic: normalizeVitalValue(parts[4]),
      bpDiastolic: normalizeVitalValue(parts[5]),
      rawText: text,
    });
  }

  return values;
}

function sameYmd(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function findNearestChartRowId(
  vitalDateTime: string,
  chartRows: Array<{ id: string; date_time: string }>,
  maxMinutes = 20,
) {
  const target = parseDateTimeLoose(vitalDateTime);
  if (!target) return null;

  let best: { id: string; diffMin: number } | null = null;
  for (const row of chartRows) {
    const d = parseDateTimeLoose(row.date_time);
    if (!d) continue;
    if (!sameYmd(target, d)) continue;
    const diffMin = Math.abs(target.getTime() - d.getTime()) / 60000;
    if (diffMin > maxMinutes) continue;
    if (!best || diffMin < best.diffMin) {
      best = { id: row.id, diffMin };
    }
  }
  return best?.id ?? null;
}

// ─── Lab item parsing ─────────────────────────────────────────────────────────

function inferFlagFromText(text: string): 'low' | 'high' | 'normal' | 'unknown' {
  const normalized = text.toLowerCase();
  if (/\b(low|l)\b/.test(normalized)) return 'low';
  if (/\b(high|h)\b/.test(normalized)) return 'high';
  if (/\b(normal|negative|nonreactive)\b/.test(normalized)) return 'normal';
  if (/\b(positive|abnormal|reactive)\b/.test(normalized)) return 'high';
  return 'unknown';
}

const LAB_ROW_END_FLAG = /^(NORMAL|LOW|HIGH|UNDER)$/i;

function isCatalystValueToken(token: string) {
  const t = token.trim();
  if (/^[-+]?\d+(?:[.,]\d+)?(?:[!A-Za-z]+)?$/.test(t)) return true;
  if (/^<\s*\d+(?:[.,]\d+)?(?:[!A-Za-z]+)?$/.test(t)) return true;
  return false;
}

function isRatioStyleAnalyteName(name: string) {
  const t = name.trim();
  if (!t.includes('/') || t.length > 56) return false;
  return /^[A-Za-z][A-Za-z0-9.]*(?:\/[A-Za-z][A-Za-z0-9.]*)+$/.test(t);
}

const LAB_VERTICAL_VALUE_FLAG = /^([-+<]?\s*\d+(?:[.,]\d+)?(?:[!A-Za-z]+)?)(?:\s+(NORMAL|LOW|HIGH|UNDER))?$/i;

function parseCatalystSingleLineRow(cleaned: string, page: number): LabItem | null {
  const lower = cleaned.toLowerCase();
  if (/^performed by\b/i.test(lower)) return null;
  if (/^pacs\b/i.test(lower)) return null;
  if (/^image date:/i.test(lower)) return null;
  if (/^name\s+unit\s+min\s+max\s+result$/i.test(cleaned.trim())) return null;

  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;

  {
    let end = tokens.length;
    let flagSuffix = '';
    if (LAB_ROW_END_FLAG.test(tokens[end - 1] ?? '')) {
      flagSuffix = tokens[end - 1];
      end -= 1;
    }
    const core = tokens.slice(0, end);
    if (core.length === 2 && isRatioStyleAnalyteName(core[0]) && isCatalystValueToken(core[1])) {
      const valueText = core[1].replace(/\s+/g, '');
      const valueNum = Number.parseFloat(valueText.replace(/^</, '').replace(',', '.'));
      return {
        page,
        rowY: 0,
        itemName: core[0].trim(),
        value: Number.isFinite(valueNum) ? valueNum : null,
        valueText,
        unit: null,
        referenceRange: null,
        flag: inferFlagFromText(flagSuffix || valueText),
        rawRow: cleaned,
      };
    }
  }

  if (tokens.length < 4) return null;

  let end = tokens.length;
  let flagSuffix = '';
  if (LAB_ROW_END_FLAG.test(tokens[end - 1] ?? '')) {
    flagSuffix = tokens[end - 1];
    end -= 1;
  }

  if (end < 4) return null;
  const resultTok = tokens[end - 1] ?? '';
  const maxTok = tokens[end - 2] ?? '';
  const minTok = tokens[end - 3] ?? '';

  if (!isCatalystValueToken(resultTok) || !isCatalystValueToken(maxTok) || !isCatalystValueToken(minTok)) {
    return null;
  }

  const rest = tokens.slice(0, end - 3);

  if (rest.length >= 2) {
    if (end < 5) return null;
    const unit = rest[rest.length - 1] ?? '';
    const itemName = rest.slice(0, -1).join(' ').trim();
    if (!itemName || !unit) return null;

    const valueText = resultTok.replace(/\s+/g, '');
    const valueNum = Number.parseFloat(valueText.replace(/^</, '').replace(',', '.'));

    return {
      page,
      rowY: 0,
      itemName,
      value: Number.isFinite(valueNum) ? valueNum : null,
      valueText,
      unit,
      referenceRange: `${minTok}-${maxTok}`,
      flag: inferFlagFromText(flagSuffix || valueText),
      rawRow: cleaned,
    };
  }

  if (rest.length === 1) {
    const itemName = (rest[0] ?? '').trim();
    if (!itemName.includes('/')) return null;

    const valueText = resultTok.replace(/\s+/g, '');
    const valueNum = Number.parseFloat(valueText.replace(/^</, '').replace(',', '.'));

    return {
      page,
      rowY: 0,
      itemName,
      value: Number.isFinite(valueNum) ? valueNum : null,
      valueText,
      unit: null,
      referenceRange: `${minTok}-${maxTok}`,
      flag: inferFlagFromText(flagSuffix || valueText),
      rawRow: cleaned,
    };
  }

  return null;
}

function looksLikeVerticalLabUnitLine(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  if (isCatalystValueToken(t)) return false;
  if (LAB_ROW_END_FLAG.test(t)) return false;
  if (/^w:\d+\s+l:\d+$/i.test(t)) return false;
  return true;
}

function hasVerticalFiveColumnTail(l3: string, l4: string, l5: string): boolean {
  return (
    Boolean(l3 && l4 && l5) &&
    isCatalystValueToken(l3) &&
    isCatalystValueToken(l4) &&
    /[-+<]?\s*\d+(?:[.,]\d+)?/.test(l5)
  );
}

function isLabVerticalNoiseLine(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  if (/^performed by\b/i.test(t)) return true;
  if (/^pacs\b/i.test(t)) return true;
  if (/^image date:/i.test(t)) return true;
  if (/^ima\s+/i.test(t)) return true;
  if (/^w:\d+\s+l:\d+/i.test(t)) return true;
  if (/^dodam\b/i.test(t)) return true;
  if (/^vivid\b/i.test(t)) return true;
  if (/^vr$/i.test(t)) return true;
  if (/^fu\s+m?$/i.test(t) || /^fu\s*m$/i.test(t)) return true;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return true;
  if (/^\d{1,2}:\d{2}(:\d{2})?(\s*(오전|오후))?$/i.test(t)) return true;
  if (/^\d+\s*,\s*\d{6,8}$/.test(t)) return true;
  if (/^[.\d]+\s*mm$/i.test(t)) return true;
  if (/\$?1\.2\.40\.0\.13\./i.test(t)) return true;
  if (/^m?m:\s*[\d.]+\s*mm$/i.test(t.replace(/\s+/g, ' '))) return true;
  if ((/^(rt\.|lt\.)/i.test(t) || /(adrenal|kidney|pancreas|spleen|gland)/i.test(t)) && !/\d/.test(t)) {
    return true;
  }
  if (/^result part title$/i.test(t)) return true;
  if (/^lab examination$/i.test(t)) return true;
  if (/^\d+\.\d+\.\d+$/.test(t)) return true;
  if (/^[wv]:\d+/i.test(t)) return true;
  return false;
}

function normalizeIntoVetHeaderBodyLines(body: string[]): string[] {
  const out: string[] = [];
  for (const raw of body) {
    const line = raw.trim();
    if (!line) continue;

    if (isLabVerticalNoiseLine(line)) {
      out.push(line);
      continue;
    }

    const tokens = line.split(/\s+/).filter(Boolean);
    if (tokens.length < 2) {
      out.push(line);
      continue;
    }

    let end = tokens.length;
    let trailingFlag: string | null = null;
    if (LAB_ROW_END_FLAG.test(tokens[end - 1] ?? '')) {
      trailingFlag = tokens[end - 1] ?? null;
      end -= 1;
    }
    if (end <= 1) {
      out.push(line);
      continue;
    }

    const tokenAt = (idx: number) => tokens[idx] ?? '';

    if (
      end >= 5 &&
      isCatalystValueToken(tokenAt(end - 1)) &&
      isCatalystValueToken(tokenAt(end - 2)) &&
      isCatalystValueToken(tokenAt(end - 3))
    ) {
      const unit = tokenAt(end - 4);
      const itemName = tokens.slice(0, end - 4).join(' ').trim();
      if (itemName && looksLikeVerticalLabUnitLine(unit)) {
        out.push(itemName, unit, tokenAt(end - 3), tokenAt(end - 2), tokenAt(end - 1));
        if (trailingFlag) out.push(trailingFlag);
        continue;
      }
    }

    if (
      end >= 4 &&
      isCatalystValueToken(tokenAt(end - 1)) &&
      isCatalystValueToken(tokenAt(end - 2)) &&
      isCatalystValueToken(tokenAt(end - 3))
    ) {
      const itemName = tokens.slice(0, end - 3).join(' ').trim();
      if (isRatioStyleAnalyteName(itemName)) {
        out.push(itemName, tokenAt(end - 3), tokenAt(end - 2), tokenAt(end - 1));
        if (trailingFlag) out.push(trailingFlag);
        continue;
      }
    }

    if (end >= 3 && isCatalystValueToken(tokenAt(end - 1))) {
      const unit = tokenAt(end - 2);
      const itemName = tokens.slice(0, end - 2).join(' ').trim();
      if (itemName && looksLikeVerticalLabUnitLine(unit)) {
        out.push(itemName, unit, tokenAt(end - 1));
        if (trailingFlag) out.push(trailingFlag);
        continue;
      }
    }

    if (end >= 2 && isCatalystValueToken(tokenAt(end - 1))) {
      const itemName = tokens.slice(0, end - 1).join(' ').trim();
      if (itemName) {
        out.push(itemName, tokenAt(end - 1));
        if (trailingFlag) out.push(trailingFlag);
        continue;
      }
    }

    out.push(line);
  }

  return out.length < Math.floor(body.length * 0.6) ? body : out;
}

export function parseLabItemsFromGroupLines(lines: BucketedLine[], chartKind: ChartKind = 'intovet'): LabItem[] {
  if (chartKind === 'plusvet') {
    const pv = parsePlusVetLabBucketLines(lines);
    const uniquePv = new Map<string, LabItem>();
    for (const item of pv) {
      const key = `${item.itemName.toUpperCase()}|${item.valueText.toUpperCase()}|${item.page}`;
      if (!uniquePv.has(key)) uniquePv.set(key, item);
    }
    return [...uniquePv.values()];
  }

  if (chartKind === 'efriends') {
    return parseEfriendsLabItemsFromBucketLines(lines);
  }

  const items: LabItem[] = [];
  const qualitativeToken = '(Normal|Negative|Positive|Abnormal|Reactive|Nonreactive|Trace)';
  const numericRowRegex =
    /^(.+?)\s+([A-Za-z%/]+)\s+([-+]?\d+(?:[.,]\d+)?)\s+([-+]?\d+(?:[.,]\d+)?)\s+([-+<]?\s*\d+(?:[.,]\d+)?(?:[!A-Za-z]+)?)(?:\s+(NORMAL|LOW|HIGH|UNDER))?$/i;
  const qualitativeRowRegex =
    new RegExp(`^(.+?)\\s+${qualitativeToken}\\s+${qualitativeToken}\\s+${qualitativeToken}$`, 'i');
  const qualitativeTokenRegex = /^(Normal|Negative|Positive|Abnormal|Reactive|Nonreactive|Trace)$/i;

  const preferNumericFirst = chartKind !== 'intovet';

  for (const line of lines) {
    const text = line.text.trim().replace(/\s+/g, ' ');
    if (!text) continue;

    const segments = text
      .split(/\s\/\s/)
      .map((segment) => segment.trim())
      .filter(Boolean);

    for (const segment of segments.length > 0 ? segments : [text]) {
      const cleaned = segment
        .replace(/^name\s+unit\s+min\s+max\s+result\s*/i, '')
        .replace(/^test\s+name\s+unit\s+min\s+max\s+result\s*/i, '')
        .trim();
      if (!cleaned) continue;

      const pushNumericIfMatch = () => {
        const numeric = cleaned.match(numericRowRegex);
        if (!numeric) return false;
        const itemName = numeric[1];
        const unit = numeric[2];
        const min = numeric[3];
        const max = numeric[4];
        const valueText = numeric[5];
        const flagText = numeric[6] ?? '';
        items.push({
          page: line.page,
          rowY: 0,
          itemName,
          value: Number.parseFloat(valueText.replace(',', '.')),
          valueText,
          unit,
          referenceRange: `${min}-${max}`,
          flag: inferFlagFromText(flagText || valueText),
          rawRow: cleaned,
        });
        return true;
      };

      if (preferNumericFirst && pushNumericIfMatch()) continue;

      const catalystItem = parseCatalystSingleLineRow(cleaned, line.page);
      if (catalystItem) { items.push(catalystItem); continue; }

      if (!preferNumericFirst && pushNumericIfMatch()) continue;

      const qualitative = cleaned.match(qualitativeRowRegex);
      if (qualitative) {
        const itemName = qualitative[1].trim();
        const valueText = qualitative[4].trim();
        items.push({
          page: line.page,
          rowY: 0,
          itemName,
          value: null,
          valueText,
          unit: null,
          referenceRange: `${qualitative[2]} ${qualitative[3]}`,
          flag: inferFlagFromText(valueText),
          rawRow: cleaned,
        });
        continue;
      }
    }
  }

  const normalized = lines.map((line) => line.text.trim()).filter(Boolean);
  const headerIndex = normalized.findIndex((line, index) => {
    return (
      /^name$/i.test(line) &&
      /^unit$/i.test(normalized[index + 1] ?? '') &&
      /^min$/i.test(normalized[index + 2] ?? '') &&
      /^max$/i.test(normalized[index + 3] ?? '') &&
      /^result$/i.test(normalized[index + 4] ?? '')
    );
  });
  if (headerIndex >= 0) {
    const bodyRaw = normalized.slice(headerIndex + 5);
    const body =
      chartKind === 'intovet' ? normalizeIntoVetHeaderBodyLines(bodyRaw) : bodyRaw;
    let cursor = 0;
    while (cursor < body.length) {
      const itemName = body[cursor]?.trim() ?? '';
      if (!itemName) break;

      if (isLabVerticalNoiseLine(itemName)) { cursor += 1; continue; }

      const l2 = body[cursor + 1]?.trim() ?? '';
      const l3 = body[cursor + 2]?.trim() ?? '';
      const l4 = body[cursor + 3]?.trim() ?? '';
      const l5 = body[cursor + 4]?.trim() ?? '';
      const l6 = body[cursor + 5]?.trim() ?? '';

      // Vertical qualitative: item + Normal + Normal + Negative
      if (l2 && l3 && l4 && qualitativeTokenRegex.test(l2) && qualitativeTokenRegex.test(l3) && qualitativeTokenRegex.test(l4)) {
        const src = lines.find((line) => line.text.trim() === itemName);
        items.push({ page: src?.page ?? 1, rowY: 0, itemName, value: null, valueText: l4, unit: null, referenceRange: `${l2} ${l3}`, flag: inferFlagFromText(l4), rawRow: `${itemName} ${l2} ${l3} ${l4}` });
        cursor += 4; continue;
      }

      // Packed qualitative variant
      if (l2 && l3 && qualitativeTokenRegex.test(l2) && /^(Normal|Negative|Positive|Abnormal|Reactive|Nonreactive|Trace)\s+(Normal|Negative|Positive|Abnormal|Reactive|Nonreactive|Trace)$/i.test(l3)) {
        const packed = l3.match(/^(Normal|Negative|Positive|Abnormal|Reactive|Nonreactive|Trace)\s+(Normal|Negative|Positive|Abnormal|Reactive|Nonreactive|Trace)$/i);
        const ref2 = packed?.[1] ?? ''; const result = packed?.[2] ?? '';
        const src = lines.find((line) => line.text.trim() === itemName);
        items.push({ page: src?.page ?? 1, rowY: 0, itemName, value: null, valueText: result, unit: null, referenceRange: `${l2} ${ref2}`.trim(), flag: inferFlagFromText(result), rawRow: `${itemName} ${l2} ${ref2} ${result}` });
        cursor += 3; continue;
      }

      // 6-line vertical quantitative: item + unit + min + max + result + FLAG
      if (l2 && l3 && l4 && l5 && l6 && looksLikeVerticalLabUnitLine(l2) && /^[-+]?\d+(?:[.,]\d+)?$/.test(l3) && /^[-+]?\d+(?:[.,]\d+)?$/.test(l4) && /[-+<]?\s*\d+(?:[.,]\d+)?/.test(l5) && LAB_ROW_END_FLAG.test(l6)) {
        const resultMatch = l5.match(/([-+<]?\s*\d+(?:[.,]\d+)?)/);
        const valueText = resultMatch ? resultMatch[1].replace(/\s+/g, '') : l5;
        const src = lines.find((line) => line.text.trim() === itemName);
        items.push({ page: src?.page ?? 1, rowY: 0, itemName, value: Number.parseFloat(valueText.replace('<', '').replace(',', '.')), valueText, unit: l2, referenceRange: `${l3}-${l4}`, flag: inferFlagFromText(l6), rawRow: `${itemName} ${l2} ${l3} ${l4} ${l5} ${l6}` });
        cursor += 6; continue;
      }

      // 5-line vertical quantitative: item + unit + min + max + result
      if (l2 && l3 && l4 && l5 && looksLikeVerticalLabUnitLine(l2) && /^[-+]?\d+(?:[.,]\d+)?$/.test(l3) && /^[-+]?\d+(?:[.,]\d+)?$/.test(l4) && /[-+<]?\s*\d+(?:[.,]\d+)?/.test(l5)) {
        const resultMatch = l5.match(/([-+<]?\s*\d+(?:[.,]\d+)?)/);
        const valueText = resultMatch ? resultMatch[1].replace(/\s+/g, '') : l5;
        const src = lines.find((line) => line.text.trim() === itemName);
        items.push({ page: src?.page ?? 1, rowY: 0, itemName, value: Number.parseFloat(valueText.replace('<', '').replace(',', '.')), valueText, unit: l2, referenceRange: `${l3}-${l4}`, flag: inferFlagFromText(l5), rawRow: `${itemName} ${l2} ${l3} ${l4} ${l5}` });
        cursor += 5; continue;
      }

      // Ratio 5-line: item + min + max + result + FLAG
      if (l2 && l3 && l4 && l5 && itemName.includes('/') && isCatalystValueToken(l2) && isCatalystValueToken(l3) && /^[-+<]?\s*\d+(?:[.,]\d+)?$/.test(l4) && LAB_ROW_END_FLAG.test(l5)) {
        const valueText = l4.replace(/\s+/g, '');
        const src = lines.find((line) => line.text.trim() === itemName);
        items.push({ page: src?.page ?? 1, rowY: 0, itemName, value: Number.parseFloat(valueText.replace('<', '').replace(',', '.')), valueText, unit: null, referenceRange: `${l2}-${l3}`, flag: inferFlagFromText(l5), rawRow: `${itemName} ${l2} ${l3} ${l4} ${l5}` });
        cursor += 5; continue;
      }

      // Ratio 4-line: item + min + max + result
      if (l2 && l3 && l4 && itemName.includes('/') && isCatalystValueToken(l2) && isCatalystValueToken(l3) && /[-+<]?\s*\d+(?:[.,]\d+)?/.test(l4)) {
        const resultMatch = l4.match(/([-+<]?\s*\d+(?:[.,]\d+)?)/);
        const valueText = resultMatch ? resultMatch[1].replace(/\s+/g, '') : l4;
        const src = lines.find((line) => line.text.trim() === itemName);
        items.push({ page: src?.page ?? 1, rowY: 0, itemName, value: Number.parseFloat(valueText.replace('<', '').replace(',', '.')), valueText, unit: null, referenceRange: `${l2}-${l3}`, flag: inferFlagFromText(l4), rawRow: `${itemName} ${l2} ${l3} ${l4}` });
        cursor += 4; continue;
      }

      // Vertical: item + unit + value (no min/max)
      if (l2 && l3 && looksLikeVerticalLabUnitLine(l2) && isCatalystValueToken(l3) && !hasVerticalFiveColumnTail(l3, l4, l5)) {
        const valueText = l3.replace(/\s+/g, '');
        const valueNum = Number.parseFloat(valueText.replace(/^</, '').replace(',', '.'));
        const src = lines.find((line) => line.text.trim() === itemName);
        items.push({ page: src?.page ?? 1, rowY: 0, itemName, value: Number.isFinite(valueNum) ? valueNum : null, valueText, unit: l2, referenceRange: null, flag: inferFlagFromText(l3), rawRow: `${itemName}\n${l2}\n${l3}` });
        cursor += 3; continue;
      }

      // Vertical single-result: item + value [NORMAL/HIGH/LOW]
      if (l2) {
        const vm = l2.match(LAB_VERTICAL_VALUE_FLAG);
        if (vm) {
          const valueText = vm[1].replace(/\s+/g, '');
          const valueNum = Number.parseFloat(valueText.replace('<', '').replace(',', '.'));
          const src = lines.find((line) => line.text.trim() === itemName);
          items.push({ page: src?.page ?? 1, rowY: 0, itemName, value: Number.isFinite(valueNum) ? valueNum : null, valueText, unit: null, referenceRange: null, flag: inferFlagFromText(valueText), rawRow: `${itemName} ${l2}` });
          cursor += 2; continue;
        }
      }

      // Vertical unit+result: item + unit + value
      if (l2 && l3 && /^[A-Za-z%/0-9.+-]+$/.test(l2) && /^[-+<]?\s*\d+(?:[.,]\d+)?$/.test(l3)) {
        const src = lines.find((line) => line.text.trim() === itemName);
        const valueText = l3.replace(/\s+/g, '');
        items.push({ page: src?.page ?? 1, rowY: 0, itemName, value: Number.parseFloat(valueText.replace('<', '').replace(',', '.')), valueText, unit: l2, referenceRange: null, flag: 'unknown', rawRow: `${itemName} ${l2} ${l3}` });
        cursor += 3; continue;
      }

      cursor += 1;
    }
  }

  const unique = new Map<string, LabItem>();
  for (const item of items) {
    const key = `${item.itemName.toUpperCase()}|${item.valueText.toUpperCase()}|${item.page}`;
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()];
}

function isLikelyNoiseLabItemName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return true;
  if (/^[-+]?\d+(?:[.,]\d+)?$/.test(trimmed)) return true;
  if (!/[A-Za-z가-힣]/.test(trimmed)) return true;
  if (/(code|treatment|prescription|qty|route|sign|date\/time|performed by)/i.test(trimmed)) {
    return true;
  }
  return false;
}

export function sanitizeLabItems<
  T extends { itemName: string; valueText: string; referenceRange?: string | null },
>(items: T[], chartKind?: ChartKind) {
  const normalizeLabValueText = (raw: string): string => {
    const compact = raw.replace(/\s+/g, '');
    const numericWithSuffix = compact.match(/^([<>]?\d+(?:[.,]\d+)?)(?:[!A-Za-z]+)$/);
    if (numericWithSuffix) return numericWithSuffix[1] ?? compact;
    return compact;
  };

  const normalized: T[] = items.map(
    (item) =>
      ({
        ...item,
        valueText: normalizeLabValueText(item.valueText ?? ''),
      }) as T,
  );

  const filtered = normalized.filter((item) => {
    if (isLikelyNoiseLabItemName(item.itemName)) return false;
    if (!item.valueText?.trim()) {
      if (chartKind === 'efriends') {
        return Boolean(item.itemName?.trim());
      }
      return false;
    }
    return true;
  });
  const unique = new Map<string, T>();
  for (const item of filtered) {
    const key =
      chartKind === 'efriends'
        ? `${item.itemName.toUpperCase().trim()}|${(item.valueText ?? '').toUpperCase().trim()}|${(item.referenceRange ?? '').toUpperCase().trim()}`
        : `${item.itemName.toUpperCase().trim()}|${item.valueText.toUpperCase().trim()}`;
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()];
}

// ─── Plan parsing ─────────────────────────────────────────────────────────────

function planAnchorScore(text: string) {
  const normalized = text.toLowerCase();
  let score = 0;
  if (/\bplan\b/.test(normalized)) score += 2;
  if (/\bcode\b/.test(normalized)) score += 1;
  if (/\btreatment\b|\bprescription\b/.test(normalized)) score += 1;
  if (/\bqty\b/.test(normalized)) score += 1;
  if (/\bunit\b/.test(normalized)) score += 1;
  if (/\bday\b/.test(normalized)) score += 1;
  if (/\btotal\b/.test(normalized)) score += 1;
  if (/\broute\b/.test(normalized)) score += 1;
  if (/\bsign\s*id\b/.test(normalized)) score += 1;
  return score;
}

function isPlusVetPlanTableHeaderLine(line: string): boolean {
  const t = line.trim().replace(/\s+/g, ' ');
  if (t.length < 12) return false;
  const lower = t.toLowerCase();
  return (
    t.includes('항목') &&
    t.includes('용법') &&
    t.includes('단위') &&
    t.includes('담당의') &&
    t.includes('일투') &&
    t.includes('일수') &&
    t.includes('사용량') &&
    lower.includes('qty')
  );
}

function findPlusVetPlanStartIndex(lines: string[]): number {
  for (let i = 0; i < lines.length - 1; i += 1) {
    const cur = (lines[i] ?? '').trim();
    if (!/^plan$/i.test(cur)) continue;
    if (isPlusVetPlanTableHeaderLine(lines[i + 1] ?? '')) {
      return i;
    }
  }
  return -1;
}

function findIntoVetStylePlanStartIndex(lines: string[]): number {
  for (let i = 0; i < lines.length; i += 1) {
    let score = planAnchorScore(lines[i]);
    for (let lookahead = 1; lookahead <= 3; lookahead += 1) {
      const next = lines[i + lookahead];
      if (!next) break;
      score += planAnchorScore(next);
    }
    if (score >= 4) {
      return i;
    }
  }
  return -1;
}

function scoreEfriendsPlanHeaderLine(t: string): number {
  let score = 0;
  if (/\bdate\b/.test(t)) score += 1;
  if (/\bdescription\b/.test(t)) score += 1;
  if (/\bamount\b/.test(t)) score += 2;
  if (/\bdoctor\b/.test(t)) score += 1;
  if (/\bkg\b/.test(t) && /\bdose\b/.test(t) && /\bday\b/.test(t)) score += 2;
  return score;
}

export function findPlanStartIndex(lines: string[], chartKind: ChartKind): number {
  if (chartKind === 'efriends') {
    for (let i = 0; i < lines.length; i += 1) {
      const cur = (lines[i] ?? '').trim().replace(/\s+/g, ' ');
      if (!/^plan\b/i.test(cur)) continue;
      const lower = cur.toLowerCase();

      if (/^plan:?$/i.test(cur)) {
        let score = 0;
        for (let j = i + 1; j < Math.min(lines.length, i + 14); j += 1) {
          const raw = (lines[j] ?? '').trim().replace(/\s+/g, ' ');
          const t = raw.toLowerCase();
          if (t === 'date' || t === 'description') score += 1;
          if (/^kg dose t\/d day qty unit$/.test(t)) score += 2;
          else if (/kg/.test(t) && /dose/.test(t) && /day/.test(t) && /qty/.test(t) && /unit/.test(t)) score += 2;
          if (/^amount doctor$/.test(t)) score += 2;
        }
        if (score >= 3) return i;
        continue;
      }

      if (scoreEfriendsPlanHeaderLine(lower) >= 3) return i;
    }
    return -1;
  }
  if (chartKind === 'plusvet' || chartKind === 'other') {
    return findPlusVetPlanStartIndex(lines);
  }
  return findIntoVetStylePlanStartIndex(lines);
}

export function buildPlanLineScores(lines: string[]) {
  return lines.map((line, index) => {
    let score = planAnchorScore(line);
    for (let lookahead = 1; lookahead <= 3; lookahead += 1) {
      const next = lines[index + lookahead];
      if (!next) break;
      score += planAnchorScore(next);
    }
    return { index, line, score };
  });
}

export function parsePlanRows(planText: string, chartKind: ChartKind = 'intovet'): ParsedPlanRow[] {
  if (chartKind === 'plusvet') {
    return parsePlusVetPlanRows(planText) as ParsedPlanRow[];
  }
  if (chartKind === 'efriends') {
    const lines = planText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) return [];

    const isHeader = (line: string) => {
      const t = line.replace(/\s+/g, ' ').trim().toLowerCase();
      if (/^plan:?$/.test(t)) return true;
      if (/^date$/.test(t) || /^description$/.test(t)) return true;
      if (/^kg\s+dose\s+t\/d\s+day\s+qty\s+unit$/i.test(line.replace(/\s+/g, ' ').trim())) return true;
      if (/^amount\s+doctor$/i.test(line.replace(/\s+/g, ' ').trim())) return true;
      if (/^plan\b/i.test(t) && scoreEfriendsPlanHeaderLine(t) >= 3) return true;
      return false;
    };
    const isAmountDoctorLine = (line: string) =>
      /^([\d,]+)\s*원(?:\s+.+)?$/i.test(line) && /원/.test(line);
    const isRowStart = (line: string) => /^20\d{2}[./-]\d{1,2}[./-]\d{1,2}\b/.test(line);
    const rows: ParsedPlanRow[] = [];
    let currentBlock: string[] = [];
    const flushBlock = () => {
      if (currentBlock.length === 0) return;
      const block = currentBlock.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
      currentBlock = [];
      if (block.length === 0) return;

      const firstDate = block[0]?.match(/^(20\d{2}[./-]\d{1,2}[./-]\d{1,2})\b/)?.[1];
      if (!firstDate) return;

      const amountLineIndex = block.findIndex((l) => isAmountDoctorLine(l));
      const amountLine = amountLineIndex >= 0 ? block[amountLineIndex] ?? '' : '';
      const amountDoctor = amountLine.match(/^([\d,]+)\s*원(?:\s+(.+))?$/i);
      let doctor = (amountDoctor?.[2] ?? '').trim();

      const bodyParts = block.filter((_, i) => i !== amountLineIndex);
      let mergedBody = bodyParts.join(' ').replace(/\s+/g, ' ').trim();
      if (!mergedBody) return;
      mergedBody = mergedBody.replace(/^(20\d{2}[./-]\d{1,2}[./-]\d{1,2})\s*/, '').trim();
      if (!mergedBody) return;
      if (!doctor) {
        const inlineAmountDoctor = mergedBody.match(/^(.*)\s+([\d,]+)\s*원\s+(.+)$/i);
        if (inlineAmountDoctor) {
          mergedBody = (inlineAmountDoctor[1] ?? '').trim();
          doctor = (inlineAmountDoctor[3] ?? '').trim();
        }
      }
      if (!mergedBody) return;

      const tokens = mergedBody.split(/\s+/).filter(Boolean);
      const nums: string[] = [];
      while (tokens.length > 0) {
        const last = tokens[tokens.length - 1] ?? '';
        if (/^\d+(?:[.,]\d+)?$/.test(last)) {
          nums.unshift(tokens.pop()!);
        } else {
          break;
        }
      }

      if (nums.length < 3) {
        const allTokens = mergedBody.split(/\s+/).filter(Boolean);
        const wonIdx = allTokens.reduce((found, tok, idx) => /^[\d,]+원$/.test(tok) ? idx : found, -1);
        if (wonIdx >= 0) {
          const doctorStr = allTokens.slice(wonIdx + 1).join(' ').trim();
          const numsInline: string[] = [];
          let descEnd = wonIdx;
          for (let k = wonIdx - 1; k >= 0; k -= 1) {
            if (/^[\d.,]+$/.test(allTokens[k] ?? '')) {
              numsInline.unshift(allTokens[k]!);
              descEnd = k;
            } else {
              break;
            }
          }
          const desc = allTokens.slice(0, descEnd).join(' ').trim();
          if (desc && numsInline.length >= 1) {
            rows.push({
              code: firstDate,
              treatmentPrescription: desc,
              qty: numsInline[0] ?? '',
              unit: numsInline.length >= 5 ? (numsInline[4] ?? '') : '',
              day: numsInline.length >= 3 ? (numsInline[2] ?? '') : '',
              total: numsInline.length >= 4 ? (numsInline[3] ?? '') : (numsInline[numsInline.length - 1] ?? ''),
              route: '',
              signId: doctorStr || doctor,
              raw: block.join(' '),
            });
          }
        }
        return;
      }

      const treatmentPrescription = tokens.join(' ').trim();
      if (!treatmentPrescription) return;

      rows.push({
        code: firstDate,
        treatmentPrescription,
        qty: nums[0] ?? '',
        unit: nums.length >= 5 ? (nums[4] ?? '') : '',
        day: nums.length >= 3 ? (nums[2] ?? '') : '',
        total: nums.length >= 4 ? (nums[3] ?? '') : nums[nums.length - 1] ?? '',
        route: '',
        signId: doctor,
        raw: block.join(' '),
      });
    };

    for (const line of lines) {
      if (isHeader(line)) continue;
      if (isRowStart(line) && currentBlock.length > 0) {
        flushBlock();
      }
      if (isRowStart(line) || currentBlock.length > 0) {
        currentBlock.push(line);
        if (isAmountDoctorLine(line)) {
          flushBlock();
        }
      }
    }
    flushBlock();
    return rows;
  }

  const lines = planText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const isHeaderLikeLine = (line: string) =>
    /plan|code|treatment|prescription|qty|unit|day|total|route|sign\s*id|\bresult\b|\bpart\b|\btitle\b|\bsign\b|처치실용/i.test(line);
  const looksLikePlanCode = (token: string) => {
    if (/^(result|part|title|sign|plan|code)$/i.test(token)) return false;
    return /^[A-Z]{1,4}[A-Z0-9-]{1,}$/i.test(token);
  };
  const hasStrongRowEnding = (line: string) =>
    /\bsign\s*id\b/i.test(line) ||
    /(?:\bpo\b|\biv\b|\bim\b|\bsc\b|\bsq\b|oral|경구|피하|정맥|근육)/i.test(line);
  const dataLines = lines.filter((line) => !isHeaderLikeLine(line));
  if (dataLines.length === 0) return [];

  const records: string[] = [];
  let buffer: string[] = [];
  const flush = () => {
    if (buffer.length === 0) return;
    records.push(buffer.join(' ').replace(/\s+/g, ' ').trim());
    buffer = [];
  };
  for (let i = 0; i < dataLines.length; i += 1) {
    const line = dataLines[i];
    const tokens = line.split(/\s+/).filter(Boolean);
    const first = tokens[0] ?? '';
    const hasPlanColumns = /(qty|unit|day|total|route|sign\s*id|\bcode\b|\btreatment\b)/i.test(line);
    const isStart = looksLikePlanCode(first) || hasPlanColumns;
    if (isStart && buffer.length > 0) flush();
    buffer.push(line);
    const next = dataLines[i + 1];
    if (!next) { flush(); continue; }
    if (hasStrongRowEnding(line)) {
      const nextTokens = next.split(/\s+/).filter(Boolean);
      const nextIsStart = looksLikePlanCode(nextTokens[0] ?? '');
      if (nextIsStart) flush();
    }
  }

  const rows: ParsedPlanRow[] = [];
  const looksLikeBillingCode = (token: string) =>
    /^(?:[A-Z]{2,}-\d{2,}(?:-\d+)?|TXTEMP\d+|[A-Z]{1,4}\d{2,})$/i.test(token);
  for (const line of records) {
    const tokens = line.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;

    const code = tokens[0] ?? '';
    const routeIndex = tokens.findIndex((token) =>
      /^(po|iv|im|sc|sq|oral|경구|피하|정맥|근육)$/i.test(token),
    );
    const numericIndexes = tokens
      .map((token, index) => ({ token, index }))
      .filter((entry) => /^\d+(?:[.,]\d+)?$/.test(entry.token))
      .map((entry) => entry.index);
    const qtyIndex = numericIndexes[0] ?? -1;
    const dayIndex = numericIndexes[1] ?? -1;
    const totalIndex = numericIndexes[2] ?? -1;
    const hasCoreNumericColumns = qtyIndex >= 0 && dayIndex >= 0 && totalIndex >= 0;
    if (!looksLikeBillingCode(code) && !hasCoreNumericColumns) continue;

    const treatmentStart = 1;
    const treatmentEnd = qtyIndex > 1 ? qtyIndex : routeIndex > 1 ? routeIndex : tokens.length;
    const treatmentPrescription = tokens.slice(treatmentStart, treatmentEnd).join(' ');

    rows.push({
      code,
      treatmentPrescription,
      qty: qtyIndex >= 0 ? tokens[qtyIndex] : '',
      unit: qtyIndex >= 0 && qtyIndex + 1 < tokens.length ? tokens[qtyIndex + 1] : '',
      day: dayIndex >= 0 ? tokens[dayIndex] : '',
      total: totalIndex >= 0 ? tokens[totalIndex] : '',
      route: routeIndex >= 0 ? tokens[routeIndex] : '',
      signId:
        tokens.length >= 2 && /[a-z]/i.test(tokens[tokens.length - 1])
          ? tokens[tokens.length - 1]
          : '',
      raw: line,
    });
  }
  return rows;
}
