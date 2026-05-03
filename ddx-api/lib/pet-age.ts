const KST_TIME_ZONE = 'Asia/Seoul';
const DAY_MS = 24 * 60 * 60 * 1000;
const YEAR_DAYS = 365.2425;

function getKstYmd(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: KST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = Number(parts.find((p) => p.type === 'year')?.value ?? '0');
  const month = Number(parts.find((p) => p.type === 'month')?.value ?? '0');
  const day = Number(parts.find((p) => p.type === 'day')?.value ?? '0');
  return { year, month, day };
}

function toUtcMidnightFromKstDate(date: Date): number {
  const { year, month, day } = getKstYmd(date);
  return Date.UTC(year, month - 1, day);
}

export function calculatePetAgeCeilFromBirthday(
  birthday: Date,
  now: Date = new Date(),
): number | null {
  const diffMs = toUtcMidnightFromKstDate(now) - toUtcMidnightFromKstDate(birthday);
  if (!Number.isFinite(diffMs) || diffMs < 0) return null;
  const diffDays = diffMs / DAY_MS;
  return Math.ceil(diffDays / YEAR_DAYS);
}

export function calculatePetAgeCeilFromYearsMonths(
  years: number,
  months: number,
): number | null {
  if (!Number.isFinite(years) || !Number.isFinite(months)) return null;
  const y = Math.max(0, Math.floor(years));
  const m = Math.max(0, Math.floor(months));
  if (y === 0 && m === 0) return null;
  const raw = y + (m / 12);
  const age = Math.ceil(raw);
  // month-only input should be treated as at least 1.
  if (y === 0 && m > 0) return Math.max(1, age);
  return age;
}

export function deriveBirthdayFromAgeAtKstJan1(
  age: number,
  now: Date = new Date(),
): Date | null {
  if (!Number.isFinite(age) || age < 0) return null;
  const { year: nowYear } = getKstYmd(now);
  const birthYear = nowYear - Math.floor(age);
  return new Date(`${birthYear}-01-01T00:00:00+09:00`);
}
