import { HEALTH_CHECKUP_COVER_STORAGE_KEYS } from '@/lib/chart-app/health-checkup-content-llm';

export type HealthCheckupValidatedPayload = {
  overallSummary: string;
  followUpCare: string;
  recheckWithin1to2Weeks: string;
  recheckWithin1Month: string;
  recheckWithin3Months: string;
  recheckWithin6Months: string;
  coverCheckupDate: string;
  coverProgram: string;
  coverVeterinarian: string;
  coverPatientName: string;
  coverPatientSpecies: string;
  coverPatientBreed: string;
  coverPatientSex: string;
  coverPatientAge: string;
  coverPatientWeight: string;
  coverOwnerName: string;
  systemsPage3Blocks: unknown[];
  systemsPage3bBlocks: unknown[];
  systemsPage4Blocks: unknown[];
  systemsPage5Blocks: unknown[];
  labInterpretation?: string;
};

const REQUIRED_KEYS: Array<
  keyof Pick<HealthCheckupValidatedPayload, 'overallSummary' | 'followUpCare'>
> = ['overallSummary', 'followUpCare'];

const RECHECK_KEYS: Array<
  keyof Pick<
    HealthCheckupValidatedPayload,
    'recheckWithin1to2Weeks' | 'recheckWithin1Month' | 'recheckWithin3Months' | 'recheckWithin6Months'
  >
> = [
  'recheckWithin1to2Weeks',
  'recheckWithin1Month',
  'recheckWithin3Months',
  'recheckWithin6Months',
];

type ValidationResult = { ok: true; value: HealthCheckupValidatedPayload } | { ok: false; error: string };

function normalizeCoverField(v: unknown): string {
  if (v === undefined || v === null) return '';
  return typeof v === 'string' ? v.trim() : String(v).trim();
}

function snapshotCoverFields(obj: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    HEALTH_CHECKUP_COVER_STORAGE_KEYS.map((k) => [k, normalizeCoverField(obj[k])]),
  ) as Record<string, string>;
}

/**
 * 필수 본문 필드만 엄격 검증하고, 표지(cover*)는 vet-report 저장 스키마처럼 항상 포함한다.
 * 검증 후 객체는 입력의 systemsPage*·labInterpretation·표지를 구조적으로 보존한다(표지는 정규화).
 */
export function validateHealthCheckupGeneratedContent(input: unknown, opts?: { runId?: string }): ValidationResult {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'generated must be an object' };
  }
  const obj = input as Record<string, unknown>;
  const required: Record<string, string> = {};
  for (const key of REQUIRED_KEYS) {
    const value = obj[key];
    if (typeof value !== 'string') {
      logCoverLoss(opts?.runId, key, 'validation_required_string', obj);
      return { ok: false, error: `generated.${key} must be a string` };
    }
    const trimmed = value.trim();
    if (!trimmed) {
      logCoverLoss(opts?.runId, key, 'validation_required_empty', obj);
      return { ok: false, error: `generated.${key} must not be empty` };
    }
    required[key] = trimmed;
  }

  // 권장 재검진: 사용자가 비워둔 시기는 빈 문자열로 그대로 통과시킨다(자동 기본값 X).
  // 편집 중 공백 보존을 위해 trim 도 하지 않는다(joinTimelineCardText 와 동일 규칙).
  const recheck: Record<string, string> = {};
  for (const key of RECHECK_KEYS) {
    const value = obj[key];
    if (value === undefined || value === null) {
      recheck[key] = '';
      continue;
    }
    if (typeof value !== 'string') {
      return { ok: false, error: `generated.${key} must be a string` };
    }
    recheck[key] = value;
  }

  const page3 = obj.systemsPage3Blocks;
  const page3b = obj.systemsPage3bBlocks;
  const page4 = obj.systemsPage4Blocks;
  const page5 = obj.systemsPage5Blocks;
  if (page3 != null && !Array.isArray(page3)) return { ok: false, error: 'generated.systemsPage3Blocks must be an array' };
  if (page3b != null && !Array.isArray(page3b))
    return { ok: false, error: 'generated.systemsPage3bBlocks must be an array' };
  if (page4 != null && !Array.isArray(page4)) return { ok: false, error: 'generated.systemsPage4Blocks must be an array' };
  if (page5 != null && !Array.isArray(page5)) return { ok: false, error: 'generated.systemsPage5Blocks must be an array' };

  const systemsPage3Blocks = Array.isArray(page3) ? page3 : [];
  const systemsPage3bBlocks = Array.isArray(page3b) ? page3b : [];
  const systemsPage4Blocks = Array.isArray(page4) ? page4 : [];
  const systemsPage5Blocks = Array.isArray(page5) ? page5 : [];

  let labInterpretation: string | undefined;
  if ('labInterpretation' in obj && obj.labInterpretation != null) {
    if (typeof obj.labInterpretation !== 'string') {
      return { ok: false, error: 'generated.labInterpretation must be a string' };
    }
    const t = obj.labInterpretation.trim();
    if (t) labInterpretation = t;
  }

  const covers = snapshotCoverFields(obj);

  const value = {
    overallSummary: required.overallSummary,
    followUpCare: required.followUpCare,
    recheckWithin1to2Weeks: recheck.recheckWithin1to2Weeks,
    recheckWithin1Month: recheck.recheckWithin1Month,
    recheckWithin3Months: recheck.recheckWithin3Months,
    recheckWithin6Months: recheck.recheckWithin6Months,
    ...covers,
    systemsPage3Blocks,
    systemsPage3bBlocks,
    systemsPage4Blocks,
    systemsPage5Blocks,
    ...(labInterpretation ? { labInterpretation } : {}),
  } as HealthCheckupValidatedPayload;

  return { ok: true, value };
}

function logCoverLoss(runId: string | undefined, failedKey: string, reason: string, obj: Record<string, unknown>): void {
  if (!runId) return;
  const snap = snapshotCoverFields(obj);
  console.warn('[health-checkup validate]', {
    runId,
    failedKey,
    reason,
    coverSnapshot: snap,
    coverKeysEmptyCount: HEALTH_CHECKUP_COVER_STORAGE_KEYS.filter((k) => snap[k] === '').length,
  });
}
