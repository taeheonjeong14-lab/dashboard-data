import {
  HEALTH_CHECKUP_MAX_COVER_BREED_CHARS,
  HEALTH_CHECKUP_MAX_COVER_SHORT_FIELD_CHARS,
  HEALTH_CHECKUP_MAX_COVER_SPECIES_CHARS,
  type HealthCheckupGeneratedContent,
} from '@/lib/chart-app/health-checkup-content-llm';
import { ageYearsCeilFromBirthIso, utcDateFromKstCalendar } from '@/lib/chart-app/patient-birth-age';
import type { ReportSourceData } from '@/lib/chart-app/report-types';

const SHORT = HEALTH_CHECKUP_MAX_COVER_SHORT_FIELD_CHARS;
/** 품종은 "래브라도리트리버"처럼 7자를 넘는 경우가 흔해 표지 셀렉트/입력 상한이 따로 있다. */
const BREED_MAX = HEALTH_CHECKUP_MAX_COVER_BREED_CHARS;
const SEX_MAX = 12;
const SPECIES_MAX = HEALTH_CHECKUP_MAX_COVER_SPECIES_CHARS;

function clamp(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return t.slice(0, max);
}

/** `run.createdAt` ISO에서 `YYYY-MM-DD` (검진일 date input용). */
export function isoDateFromRunCreatedAt(iso: string | undefined): string | undefined {
  if (!iso?.trim()) return undefined;
  const m = iso.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : undefined;
}

/**
 * 차트 basicInfo 등 DB 발췌 성별 문자열을 표지 셀렉트 값으로 가능한 한 맞춤.
 * 매칭 실패 시 잘린 원문 반환(레거시 옵션으로 UI에 표시).
 */
export function mapDbSexToCoverSex(raw: string | null | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  const u = raw.trim();
  const ul = u.toLowerCase();

  if (u === '암컷(중성화)' || u === '수컷(중성화)' || u === '암컷' || u === '수컷') return u;

  const neuter = /중성|neut|spay|castrat|\bfs\b|\bmn\b/i.test(u);
  const femaleish =
    u.includes('암') ||
    ul === 'f' ||
    ul === 'fs' ||
    ul === 'female' ||
    ul.startsWith('f ') ||
    /^f$/i.test(u);
  const maleish =
    (u.includes('수') && !u.includes('암')) ||
    ul === 'm' ||
    ul === 'male' ||
    ul === 'mn' ||
    /^m$/i.test(u);

  if (neuter) {
    if (femaleish && !maleish) return '암컷(중성화)';
    if (maleish && !femaleish) return '수컷(중성화)';
  }
  if (femaleish && !maleish) return '암컷';
  if (maleish && !femaleish) return '수컷';

  return clamp(u, SEX_MAX);
}

/**
 * 차트 발췌 종 문자열(개·강아지·犬·Canine·Dog·고양이·묘·Feline…)을 표지 셀렉트 값으로 맞춘다.
 * admin 표지 셀렉트 옵션은 'Canine (개)' / 'Feline (고양이)' 두 개뿐이라, 정확히 일치하지 않으면
 * 미선택으로 남는다(성별의 mapDbSexToCoverSex 와 같은 이유로 필요).
 * 매칭 실패 시 잘린 원문 반환 — admin 이 직접 고르게 둔다.
 */
export function mapDbSpeciesToCoverSpecies(raw: string | null | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  const u = raw.trim();
  if (u === 'Canine (개)' || u === 'Feline (고양이)') return u;

  const s = u.toLowerCase();
  if (/고양이|고양|feline|cat|괭이|묘|냥/.test(s)) return 'Feline (고양이)';
  if (/강아지|개|dog|canine|k9|견|犬/.test(s)) return 'Canine (개)';

  return clamp(u, SPECIES_MAX);
}

function coverFieldNeedsSourceDefault(v: unknown): boolean {
  return v === undefined || v === null;
}

/** `undefined`·`null`인 표지 필드만 차트 DB에서 채움. 빈 문자열(`""`)은 보존. */
export function applyHealthCheckupCoverFromSource(
  payload: HealthCheckupGeneratedContent,
  source: ReportSourceData,
): HealthCheckupGeneratedContent {
  const b = source.basicInfo;
  const next: HealthCheckupGeneratedContent = { ...payload };

  const setIfUnset = (key: keyof HealthCheckupGeneratedContent, value: string | undefined) => {
    if (value === undefined || value === '') return;
    if (!coverFieldNeedsSourceDefault(next[key])) return;
    (next as Record<string, string>)[key as string] = value;
  };

  const isoRun = isoDateFromRunCreatedAt(source.run.createdAt);
  setIfUnset('coverCheckupDate', isoRun);

  if (b) {
    setIfUnset('coverPatientName', b.patientName ? clamp(b.patientName, SHORT) : undefined);
    setIfUnset('coverPatientSpecies', mapDbSpeciesToCoverSpecies(b.species));
    setIfUnset('coverPatientBreed', b.breed ? clamp(b.breed, BREED_MAX) : undefined);
    setIfUnset('coverPatientSex', mapDbSexToCoverSex(b.sex));
    const ageFromDb =
      typeof b.age === 'number' && Number.isFinite(b.age) ? Math.trunc(b.age) : null;
    const ageFallback =
      ageFromDb != null ? ageFromDb : b.birth ? ageYearsCeilFromBirthIso(b.birth, utcDateFromKstCalendar()) : null;
    setIfUnset(
      'coverPatientAge',
      ageFallback != null ? clamp(String(ageFallback), SHORT) : undefined,
    );
    setIfUnset('coverOwnerName', b.ownerName ? clamp(b.ownerName, SHORT) : undefined);
  }

  return next;
}
