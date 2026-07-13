/**
 * 건강검진 보고서 컨텐츠의 **클라이언트 안전(pure)** 타입·파싱·검증 로직.
 *
 * `health-checkup-content-llm.ts` 는 gemini/db(pg) 같은 서버 전용 모듈을 최상단에서 import 하므로,
 * 클라이언트 컴포넌트(share-review-client)가 그 모듈에서 순수 함수를 가져오면 모듈 그래프 전체가
 * 브라우저 번들로 끌려와 `pg`의 `tls`에서 빌드가 깨진다. 그래서 서버 의존이 없는 부분만 여기로 분리한다.
 * (content-llm 은 하위 호환을 위해 이 파일의 심볼을 그대로 re-export 한다.)
 */
import {
  HEALTH_CHECKUP_MAX_RECHECK_BODY_CHARS,
  HEALTH_CHECKUP_MAX_RECHECK_TITLE_CHARS,
} from '@/lib/chart-app/health-checkup-limits';
import { joinTimelineCardText } from '@/lib/chart-app/health-report-timeline-card';

export type HealthCheckupGeneratedContent = {
  overallSummary: string;
  followUpCare: string;
  recheckWithin1to2Weeks: string;
  recheckWithin1Month: string;
  recheckWithin3Months: string;
  recheckWithin6Months: string;
  coverCheckupDate?: string;
  coverProgram?: string;
  coverVeterinarian?: string;
  coverPatientName?: string;
  coverPatientSpecies?: string;
  coverPatientBreed?: string;
  coverPatientSex?: string;
  coverPatientAge?: string;
  coverPatientWeight?: string;
  coverOwnerName?: string;
  systemsPage3Blocks?: unknown;
  systemsPage3bBlocks?: unknown;
  systemsPage4Blocks?: unknown;
  systemsPage5Blocks?: unknown;
  labInterpretation?: string;
};

export const HEALTH_CHECKUP_MAX_COVER_FIELD_CHARS = 500;
export const HEALTH_CHECKUP_MAX_COVER_SHORT_FIELD_CHARS = 7;
// 품종은 "래브라도리트리버"(8자)처럼 7자를 넘는 경우가 흔해 별도로 넉넉히 둔다.
export const HEALTH_CHECKUP_MAX_COVER_BREED_CHARS = 20;
// 종은 표지 셀렉트 값이 'Canine (개)'·'Feline (고양이)'(13자)라 7자로 자르면 옵션과 안 맞아 미선택이 된다.
export const HEALTH_CHECKUP_MAX_COVER_SPECIES_CHARS = 20;
export const HEALTH_CHECKUP_MAX_COVER_CHECKUP_DATE_CHARS = 32;
export const HEALTH_CHECKUP_MAX_COVER_SEX_CHARS = 12;

/** 저장·검증에서 항상 존재해야 하는 표지 키(vet-report 패리티). */
export const HEALTH_CHECKUP_COVER_STORAGE_KEYS = [
  'coverCheckupDate',
  'coverProgram',
  'coverVeterinarian',
  'coverPatientName',
  'coverPatientSpecies',
  'coverPatientBreed',
  'coverPatientSex',
  'coverPatientAge',
  'coverPatientWeight',
  'coverOwnerName',
] as const satisfies readonly (keyof HealthCheckupGeneratedContent)[];

const COVER_FIELD_KEYS = HEALTH_CHECKUP_COVER_STORAGE_KEYS;

function maxCharsForCoverField(key: (typeof COVER_FIELD_KEYS)[number]): number {
  switch (key) {
    case 'coverCheckupDate':
      return HEALTH_CHECKUP_MAX_COVER_CHECKUP_DATE_CHARS;
    case 'coverProgram':
    case 'coverVeterinarian':
      return HEALTH_CHECKUP_MAX_COVER_FIELD_CHARS;
    case 'coverPatientName':
    case 'coverPatientAge':
    case 'coverPatientWeight':
    case 'coverOwnerName':
      return HEALTH_CHECKUP_MAX_COVER_SHORT_FIELD_CHARS;
    case 'coverPatientSpecies':
      return HEALTH_CHECKUP_MAX_COVER_SPECIES_CHARS;
    case 'coverPatientBreed':
      return HEALTH_CHECKUP_MAX_COVER_BREED_CHARS;
    case 'coverPatientSex':
      return HEALTH_CHECKUP_MAX_COVER_SEX_CHARS;
    default:
      return HEALTH_CHECKUP_MAX_COVER_FIELD_CHARS;
  }
}

export function clampText(s: unknown, max: number): string {
  const t = typeof s === 'string' ? s.trim() : '';
  return t.length <= max ? t : t.slice(0, max);
}

export function clampStoredRecheckCard(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : '';
  const nl = s.indexOf('\n');
  let title = '';
  let body = '';
  if (nl === -1) {
    body = s.trim();
  } else {
    title = s.slice(0, nl).trim();
    const rest = s.slice(nl + 1);
    const nl2 = rest.indexOf('\n');
    body = (nl2 === -1 ? rest : rest.slice(0, nl2)).trim();
    if (!body) {
      body = title;
      title = '';
    }
  }
  title = clampText(title, HEALTH_CHECKUP_MAX_RECHECK_TITLE_CHARS);
  body = clampText(body, HEALTH_CHECKUP_MAX_RECHECK_BODY_CHARS);
  return joinTimelineCardText(title, body);
}

function pickCoverFields(o: Record<string, unknown>): Partial<HealthCheckupGeneratedContent> {
  const out: Partial<HealthCheckupGeneratedContent> = {};
  for (const key of COVER_FIELD_KEYS) {
    if (!(key in o)) continue;
    (out as Record<string, string>)[key] = clampText(o[key], maxCharsForCoverField(key));
  }
  return out;
}

function healthCheckupFromPlainObject(o: Record<string, unknown>): HealthCheckupGeneratedContent {
  return {
    overallSummary: typeof o.overallSummary === 'string' ? o.overallSummary.trim() : '',
    followUpCare: typeof o.followUpCare === 'string' ? o.followUpCare.trim() : '',
    recheckWithin1to2Weeks: clampStoredRecheckCard(o.recheckWithin1to2Weeks),
    recheckWithin1Month: clampStoredRecheckCard(o.recheckWithin1Month),
    recheckWithin3Months: clampStoredRecheckCard(o.recheckWithin3Months),
    recheckWithin6Months: clampStoredRecheckCard(o.recheckWithin6Months),
    ...pickCoverFields(o),
    ...('systemsPage3Blocks' in o ? { systemsPage3Blocks: o.systemsPage3Blocks } : {}),
    ...('systemsPage3bBlocks' in o ? { systemsPage3bBlocks: o.systemsPage3bBlocks } : {}),
    ...('systemsPage4Blocks' in o ? { systemsPage4Blocks: o.systemsPage4Blocks } : {}),
    ...('systemsPage5Blocks' in o ? { systemsPage5Blocks: o.systemsPage5Blocks } : {}),
    ...(typeof o.labInterpretation === 'string' ? { labInterpretation: o.labInterpretation } : {}),
  };
}

export function parseHealthCheckupPayloadFromStorage(raw: unknown): HealthCheckupGeneratedContent {
  if (!raw || typeof raw !== 'object') return healthCheckupFromPlainObject({});
  return healthCheckupFromPlainObject(raw as Record<string, unknown>);
}
