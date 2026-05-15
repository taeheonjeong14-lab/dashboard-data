import type { ChartKind } from '@/lib/text-bucketing/chart-kind';

/** Parsed basic info row before birth/age normalization */
export type BasicInfoBirthAgeInput = {
  hospitalName: string | null;
  ownerName: string | null;
  patientName: string | null;
  species: string | null;
  breed: string | null;
  birth: string | null;
  sex: string | null;
};

export type BasicInfoBirthAgeResult = BasicInfoBirthAgeInput & {
  /** `YYYY-MM-DD` only when known */
  birth: string | null;
  /** Whole years, ceiling of elapsed time / 365.25y (see `ageYearsCeilFromBirthIso`) */
  age: number | null;
};

const MS_PER_AVG_YEAR = 365.25 * 24 * 60 * 60 * 1000;

/** Leading `YYYY-MM-DD` if valid calendar date */
export function parseLeadingIsoDate(raw: string | null | undefined): string | null {
  const t = (raw ?? '').trim();
  const m = t.match(/^(\d{4}-\d{2}-\d{2})\b/);
  if (!m) return null;
  const iso = m[1];
  const [y, mo, d] = iso.split('-').map((x) => Number.parseInt(x, 10));
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return iso;
}

/** Same rules as eFriends `normalizeCompactDate` in text-bucketing route */
export function normalizeBirthToIso(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const t = value.trim();
  const compact = t.match(/\b(19\d{2}|20\d{2})(0[1-9]|1[0-2])([0-2]\d|3[01])\b/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const ymd = t.match(/\b(19\d{2}|20\d{2})[./-](\d{1,2})[./-](\d{1,2})\b/);
  if (!ymd) return null;
  const mo = String(Number.parseInt(ymd[2] ?? '0', 10)).padStart(2, '0');
  const d = String(Number.parseInt(ymd[3] ?? '0', 10)).padStart(2, '0');
  const iso = `${ymd[1]}-${mo}-${d}`;
  return parseLeadingIsoDate(iso);
}

/** PlusVet `3Y 2M` style (case-insensitive, flexible spaces) */
export function parsePlusVetAgeYM(raw: string | null | undefined): { years: number; months: number } | null {
  const t = (raw ?? '').trim();
  const m = t.match(/(\d+)\s*Y\s*(\d+)\s*M/i);
  if (!m) return null;
  const years = Number.parseInt(m[1] ?? '', 10);
  const months = Number.parseInt(m[2] ?? '', 10);
  if (!Number.isFinite(years) || !Number.isFinite(months) || years < 0 || months < 0 || months > 11) return null;
  return { years, months };
}

/** Asia/Seoul calendar "today" as UTC midnight for that civil date */
export function utcDateFromKstCalendar(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === 'year')?.value ?? 'NaN');
  const mo = Number(parts.find((p) => p.type === 'month')?.value ?? 'NaN');
  const d = Number(parts.find((p) => p.type === 'day')?.value ?? 'NaN');
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return new Date(NaN);
  return new Date(Date.UTC(y, mo - 1, d));
}

export function utcDateFromIsoDateOnly(iso: string): Date | null {
  const p = parseLeadingIsoDate(iso);
  if (!p) return null;
  const [y, mo, d] = p.split('-').map((x) => Number.parseInt(x, 10));
  return new Date(Date.UTC(y, mo - 1, d));
}

export function subYearsMonthsUtc(origin: Date, years: number, months: number): Date {
  const y = origin.getUTCFullYear() - years;
  const m = origin.getUTCMonth() - months;
  return new Date(Date.UTC(y, m, origin.getUTCDate()));
}

/** PlusVet: approximate birth year from visit − Y − M, then force Jan 1 (UTC calendar). */
export function syntheticBirthJan1FromVisitUtc(visit: Date, years: number, months: number): string | null {
  if (!Number.isFinite(visit.getTime())) return null;
  const approx = subYearsMonthsUtc(visit, years, months);
  const yy = approx.getUTCFullYear();
  if (!Number.isFinite(yy) || yy < 1900 || yy > 2100) return null;
  return `${String(yy).padStart(4, '0')}-01-01`;
}

/**
 * Elapsed time from birth (UTC date) to ref (UTC date), in average Julian years, rounded up.
 * Same calendar day → 0. Example: slightly over 3 average years → 4.
 */
export function ageYearsCeilFromBirthIso(birthIso: string | null | undefined, refUtcDate: Date): number | null {
  const birth = parseLeadingIsoDate(birthIso ?? '');
  if (!birth) return null;
  const b = utcDateFromIsoDateOnly(birth);
  if (!b || Number.isNaN(b.getTime())) return null;
  const r = new Date(Date.UTC(refUtcDate.getUTCFullYear(), refUtcDate.getUTCMonth(), refUtcDate.getUTCDate()));
  if (Number.isNaN(r.getTime())) return null;
  const diff = r.getTime() - b.getTime();
  if (diff < 0) return null;
  if (diff === 0) return 0;
  return Math.ceil(diff / MS_PER_AVG_YEAR);
}

/** First `YYYY-MM-DD` at start of dateTime-ish strings */
export function extractLeadingDateFromDateTime(raw: string | null | undefined): Date | null {
  return utcDateFromIsoDateOnly(parseLeadingIsoDate(raw ?? '') ?? '');
}

export function maxVisitDateUtc(
  chartBodyByDate: ReadonlyArray<{ dateTime: string }>,
  labItemsByDate: ReadonlyArray<{ dateTime: string }>,
  runCreatedAtIso: string,
): Date {
  let max: Date | null = null;
  for (const g of chartBodyByDate) {
    const d = extractLeadingDateFromDateTime(g.dateTime);
    if (d && !Number.isNaN(d.getTime()) && (!max || d.getTime() > max.getTime())) max = d;
  }
  for (const g of labItemsByDate) {
    const d = extractLeadingDateFromDateTime(g.dateTime);
    if (d && !Number.isNaN(d.getTime()) && (!max || d.getTime() > max.getTime())) max = d;
  }
  if (max) return max;
  const fallback = parseLeadingIsoDate(runCreatedAtIso.slice(0, 10)) ?? runCreatedAtIso.slice(0, 10);
  const fb = utcDateFromIsoDateOnly(fallback);
  if (fb && !Number.isNaN(fb.getTime())) return fb;
  return utcDateFromKstCalendar();
}

/**
 * Intovet / other: strip `yyyy-mm-dd(0Y0D)` to date; fall back to `normalizeBirthToIso`.
 */
export function resolveIntovetBirthIso(raw: string | null | undefined): string | null {
  const fromPrefix = parseLeadingIsoDate(raw);
  if (fromPrefix) return fromPrefix;
  return normalizeBirthToIso(raw);
}

export function finalizeBasicInfoBirthAndAge(
  chartKind: ChartKind,
  parsed: BasicInfoBirthAgeInput,
  opts: {
    chartBodyByDate: ReadonlyArray<{ dateTime: string }>;
    labItemsByDate: ReadonlyArray<{ dateTime: string }>;
    runCreatedAtIso: string;
  },
  now: Date = new Date(),
): BasicInfoBirthAgeResult {
  const todayKst = utcDateFromKstCalendar(now);

  if (chartKind === 'plusvet') {
    const ym = parsePlusVetAgeYM(parsed.birth);
    if (!ym) {
      return { ...parsed, birth: null, age: null };
    }
    const visit = maxVisitDateUtc(opts.chartBodyByDate, opts.labItemsByDate, opts.runCreatedAtIso);
    const birthIso = syntheticBirthJan1FromVisitUtc(visit, ym.years, ym.months);
    if (!birthIso) {
      return { ...parsed, birth: null, age: null };
    }
    const age = ageYearsCeilFromBirthIso(birthIso, todayKst);
    return { ...parsed, birth: birthIso, age };
  }

  if (chartKind === 'efriends') {
    const birthIso = normalizeBirthToIso(parsed.birth) ?? parseLeadingIsoDate(parsed.birth);
    const age = birthIso ? ageYearsCeilFromBirthIso(birthIso, todayKst) : null;
    return { ...parsed, birth: birthIso, age };
  }

  // intovet + other
  const birthIso = resolveIntovetBirthIso(parsed.birth);
  const age = birthIso ? ageYearsCeilFromBirthIso(birthIso, todayKst) : null;
  return { ...parsed, birth: birthIso, age };
}
