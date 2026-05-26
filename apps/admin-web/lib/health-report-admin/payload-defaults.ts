import type { HealthCheckupGeneratedContent } from '@/lib/health-report-admin/types';

export function emptyHealthCheckupPayload(): HealthCheckupGeneratedContent {
  return {
    overallSummary: '',
    followUpCare: '',
    recheckWithin1to2Weeks: '',
    recheckWithin1Month: '',
    recheckWithin3Months: '',
    recheckWithin6Months: '',
    coverCheckupDate: '',
    coverProgram: '',
    coverVeterinarian: '',
    coverPatientName: '',
    coverPatientSpecies: '',
    coverPatientBreed: '',
    coverPatientSex: '',
    coverPatientAge: '',
    coverPatientWeight: '',
    coverOwnerName: '',
    systemsPage3Blocks: [],
    systemsPage3bBlocks: [],
    systemsPage4Blocks: [],
    systemsPage5Blocks: [],
    labInterpretation: '',
  };
}

function strField(o: Record<string, unknown>, key: string, fallback = ''): string {
  const v = o[key];
  return typeof v === 'string' ? v : fallback;
}

/** DB payload → 편집기 초기값 (누락 필드는 기본값). */
export function mergeHealthPayloadFromStorage(raw: unknown): HealthCheckupGeneratedContent {
  const d = emptyHealthCheckupPayload();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return d;
  const o = raw as Record<string, unknown>;
  return {
    overallSummary: strField(o, 'overallSummary', d.overallSummary),
    followUpCare: strField(o, 'followUpCare', d.followUpCare),
    recheckWithin1to2Weeks: strField(o, 'recheckWithin1to2Weeks', d.recheckWithin1to2Weeks),
    recheckWithin1Month: strField(o, 'recheckWithin1Month', d.recheckWithin1Month),
    recheckWithin3Months: strField(o, 'recheckWithin3Months', d.recheckWithin3Months),
    recheckWithin6Months: strField(o, 'recheckWithin6Months', d.recheckWithin6Months),
    coverCheckupDate: strField(o, 'coverCheckupDate', d.coverCheckupDate),
    coverProgram: strField(o, 'coverProgram', d.coverProgram),
    coverVeterinarian: strField(o, 'coverVeterinarian', d.coverVeterinarian),
    coverPatientName: strField(o, 'coverPatientName', d.coverPatientName),
    coverPatientSpecies: strField(o, 'coverPatientSpecies', d.coverPatientSpecies),
    coverPatientBreed: strField(o, 'coverPatientBreed', d.coverPatientBreed),
    coverPatientSex: strField(o, 'coverPatientSex', d.coverPatientSex),
    coverPatientAge: strField(o, 'coverPatientAge', d.coverPatientAge),
    coverPatientWeight: strField(o, 'coverPatientWeight', d.coverPatientWeight),
    coverOwnerName: strField(o, 'coverOwnerName', d.coverOwnerName),
    systemsPage3Blocks: Array.isArray(o.systemsPage3Blocks) ? o.systemsPage3Blocks : [],
    systemsPage3bBlocks: Array.isArray(o.systemsPage3bBlocks) ? o.systemsPage3bBlocks : [],
    systemsPage4Blocks: Array.isArray(o.systemsPage4Blocks) ? o.systemsPage4Blocks : [],
    systemsPage5Blocks: Array.isArray(o.systemsPage5Blocks) ? o.systemsPage5Blocks : [],
    labInterpretation: strField(o, 'labInterpretation', d.labInterpretation ?? ''),
  };
}
