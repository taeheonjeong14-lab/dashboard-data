import { geminiGenerateText, tryParseJsonObject } from '@/lib/chart-app/gemini';
import { EXAM_TYPE_LABEL_KO, RADIOLOGY_SUB_LABEL_KO } from '@/lib/chart-app/image-case-types';
import {
  HEALTH_CHECKUP_MAX_FOLLOW_UP_CHARS,
  HEALTH_CHECKUP_MAX_OVERALL_CHARS,
  HEALTH_CHECKUP_MAX_RECHECK_BODY_CHARS,
  HEALTH_CHECKUP_MAX_RECHECK_TITLE_CHARS,
  HEALTH_CHECKUP_PROMPT_DENTAL_SKIN_DX_MAX_CHARS,
  HEALTH_CHECKUP_PROMPT_DENTAL_SKIN_IMP_MAX_CHARS,
  HEALTH_CHECKUP_PROMPT_IMAGING_INTERP_MAX_CHARS,
  HEALTH_CHECKUP_PROMPT_LAB_INTERP_MAX_CHARS,
  HEALTH_CHECKUP_PROMPT_MAX_FOLLOW_UP_CHARS,
  HEALTH_CHECKUP_PROMPT_MAX_OVERALL_CHARS,
  HEALTH_CHECKUP_PROMPT_MIN_FOLLOW_UP_CHARS,
  HEALTH_CHECKUP_PROMPT_MIN_OVERALL_CHARS,
  HEALTH_CHECKUP_PROMPT_SYSTEMS_DX_MAX_CHARS,
  HEALTH_CHECKUP_PROMPT_SYSTEMS_IMP_MAX_CHARS,
} from '@/lib/chart-app/health-checkup-limits';
import { buildHealthCheckupInstructionBody } from '@/lib/chart-app/health-checkup-prompt-instructions';
import {
  HEALTH_CHECKUP_SYSTEMS_LLM_FIELD_KEYS,
  mergeHealthSystemsDemosWithLlmFields,
} from '@/lib/chart-app/health-checkup-systems-llm-merge';
import { joinTimelineCardText } from '@/lib/chart-app/health-report-timeline-card';
import type { ReportSourceData } from '@/lib/chart-app/report-types';

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

const MAX_OVERALL = HEALTH_CHECKUP_MAX_OVERALL_CHARS;
const MAX_FOLLOW_UP = HEALTH_CHECKUP_MAX_FOLLOW_UP_CHARS;
const PROMPT_MAX_OVERALL = HEALTH_CHECKUP_PROMPT_MAX_OVERALL_CHARS;
const PROMPT_MAX_FOLLOW_UP = HEALTH_CHECKUP_PROMPT_MAX_FOLLOW_UP_CHARS;

export const HEALTH_CHECKUP_MAX_COVER_FIELD_CHARS = 500;
export const HEALTH_CHECKUP_MAX_COVER_SHORT_FIELD_CHARS = 7;
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
    case 'coverPatientSpecies':
    case 'coverPatientBreed':
    case 'coverPatientAge':
    case 'coverPatientWeight':
    case 'coverOwnerName':
      return HEALTH_CHECKUP_MAX_COVER_SHORT_FIELD_CHARS;
    case 'coverPatientSex':
      return HEALTH_CHECKUP_MAX_COVER_SEX_CHARS;
    default:
      return HEALTH_CHECKUP_MAX_COVER_FIELD_CHARS;
  }
}

function examTypeLabel(examType: keyof typeof EXAM_TYPE_LABEL_KO, radiologySub: keyof typeof RADIOLOGY_SUB_LABEL_KO | null) {
  if (examType === 'radiology' && radiologySub) return `${EXAM_TYPE_LABEL_KO.radiology}(${RADIOLOGY_SUB_LABEL_KO[radiologySub]})`;
  return EXAM_TYPE_LABEL_KO[examType] ?? EXAM_TYPE_LABEL_KO.other;
}

function clampText(s: unknown, max: number): string {
  const t = typeof s === 'string' ? s.trim() : '';
  return t.length <= max ? t : t.slice(0, max);
}

function clampStoredRecheckCard(raw: unknown): string {
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

function matchesCheckupDate(dateTimeStr: string, checkupDate: string): boolean {
  return dateTimeStr.startsWith(checkupDate);
}

function buildHealthCheckupPrompt(
  source: ReportSourceData,
  options?: { reportProgramName?: string; checkupDate?: string; veterinarian?: string; mustInclude?: string },
  internal?: { outputStage?: 1 },
): string {
  const programName = (options?.reportProgramName ?? '').trim();
  const programPrefixForPhrase = programName.length > 0 ? programName : '해당';
  const excludedAreaExactPhrase = `${programPrefixForPhrase} 프로그램 미포함 영역`;
  const checkupDate = options?.checkupDate?.trim() ?? '';
  const mustInclude = options?.mustInclude?.trim() ?? '';

  const chartSource = checkupDate ? source.chartBodyByDate.filter((c) => matchesCheckupDate(c.dateTime, checkupDate)) : source.chartBodyByDate;
  const labSource = checkupDate ? source.labItemsByDate.filter((d) => matchesCheckupDate(d.dateTime, checkupDate)) : source.labItemsByDate;
  const imageSource = checkupDate ? source.caseImages.filter((img) => matchesCheckupDate(img.examDate, checkupDate)) : source.caseImages;
  const vacSource = checkupDate
    ? source.vaccinationRecords.filter((v) => v.administeredDate != null && matchesCheckupDate(v.administeredDate, checkupDate))
    : source.vaccinationRecords;
  const physicalExamSource = checkupDate
    ? source.physicalExamItemsByDate.filter((d) => matchesCheckupDate(d.dateTime, checkupDate))
    : source.physicalExamItemsByDate;

  const chartLines = chartSource.slice(0, 20).map((c, i) => {
    const body = c.bodyText.slice(0, 10000);
    const plan = c.planText?.trim() ? ` [처방/플랜] ${c.planText.slice(0, 5000)}` : '';
    return `${i + 1}. ${c.dateTime} | ${body}${plan}`;
  });
  const labLines = labSource.slice(0, 20).map((d, i) => {
    const joined = d.items.slice(0, 15).map((x) => `${x.itemName}=${x.valueText}${x.unit ?? ''}(${x.flag})`).join(', ');
    return `${i + 1}. ${d.dateTime} | ${joined}`;
  });
  const vacLines = vacSource.slice(0, 30).map((v, i) => `${i + 1}. ${v.productName} | ${v.administeredDate ?? '-'} | ${v.recordType} ${v.doseOrder}`);
  const imageLines = imageSource.slice(0, 40).map((img, i) => {
    const label = examTypeLabel((img.examType as keyof typeof EXAM_TYPE_LABEL_KO) || 'other', img.radiologySub);
    return `${i + 1}. ${img.examDate} | ${label} | 주목=${img.hasNotableFinding ? '있음' : '없음'} | ${img.briefComment}`;
  });
  const physicalExamLines = physicalExamSource
    .flatMap((d) => d.items.map((item) => ({ dateTime: d.dateTime, ...item })))
    .filter((item) => !['nrf', 'normal', 'good', '양호', '정상'].includes(item.valueText.trim().toLowerCase()))
    .slice(0, 30)
    .map((item, i) => `${i + 1}. ${item.dateTime} | ${item.itemName} | ref=${item.referenceRange ?? '-'} | value=${item.valueText}${item.unit ? ` ${item.unit}` : ''}`);

  const instruction = buildHealthCheckupInstructionBody({
    programPrefixForPhrase,
    excludedAreaExactPhrase,
    checkupDate: checkupDate || undefined,
    mustInclude: mustInclude || undefined,
    outputStage: internal?.outputStage,
  });

  return [
    instruction,
    '',
    '========== 참고 데이터 (이하 실제 케이스 발췌) ==========',
    '환자 기본 정보:',
    `- 병원: ${source.basicInfo?.hospitalName ?? '-'}`,
    `- 보호자: ${source.basicInfo?.ownerName ?? '-'}`,
    `- 환자명: ${source.basicInfo?.patientName ?? '-'}`,
    `- 종/품종: ${source.basicInfo?.species ?? '-'} / ${source.basicInfo?.breed ?? '-'}`,
    `- 생년월일/연령(참고): ${source.basicInfo?.birth ?? '-'} / ${source.basicInfo?.age != null ? `${source.basicInfo.age}` : '-'}`,
    '',
    '차트 본문(발췌):',
    ...(chartLines.length ? chartLines : ['(없음)']),
    '',
    '검사 수치(발췌):',
    ...(labLines.length ? labLines : ['(없음)']),
    '',
    '접종 기록(발췌):',
    ...(vacLines.length ? vacLines : ['(없음)']),
    '',
    '신체검사 특이사항(참고):',
    ...(physicalExamLines.length ? physicalExamLines : ['(특이사항 없음/데이터 없음)']),
    '',
    '이미지 분석 요약:',
    ...(imageLines.length ? imageLines : ['(이미지 없음)']),
    '',
    '========== 출력 ==========',
    '- 응답은 **유효한 JSON 객체 하나만**. 마크다운 코드 펜스나 설명 문장·키 밖의 텍스트를 넣지 않는다.',
    ...(mustInclude
      ? ['- 상단 「반드시 포함·강조해야 하는 내용」에 적힌 요구는 **종합 소견·사후 관리·장기·검사·영상·혈액 해석 등 적절한 JSON 필드 전반**에 원문 의미가 빠짐없이 반영되었는지 출력 직전에 다시 확인한다.']
      : []),
    `- overallSummary는 공백 포함 최소 ${HEALTH_CHECKUP_PROMPT_MIN_OVERALL_CHARS}자·최대 ${HEALTH_CHECKUP_PROMPT_MAX_OVERALL_CHARS}자, followUpCare는 최소 ${HEALTH_CHECKUP_PROMPT_MIN_FOLLOW_UP_CHARS}자·최대 ${HEALTH_CHECKUP_PROMPT_MAX_FOLLOW_UP_CHARS}자.`,
    '- overallSummary, followUpCare·장기·영상 각 칸 문자열은 위 **문단·줄바꿈 공통 규칙**을 따른다(새 문단 앞마다 빈 줄 한 줄, JSON에서는 연속 줄바꿈 두 번). 재검진 필드는 예외.',
    '- 확정 진단·단정적 병명 단정은 피하고, 관찰 소견·해석 가능한 범위·권고 중심으로 쓴다.',
    ...(internal?.outputStage === 1 ? [] : [
      '- hp3_* · hp4_* · hp5_* 각 문자열은 인쇄 표 칸에 그대로 들어간다. 완전한 문장으로 쓰고, **문단 사이**는 위와 같이 빈 줄 한 줄로만 구분한다(문단 **내부**에 쓸데없는 빈 줄은 넣지 않는다).',
    ]),
  ].join('\n');
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
    overallSummary: clampText(o.overallSummary, MAX_OVERALL),
    followUpCare: clampText(o.followUpCare, MAX_FOLLOW_UP),
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

function normalizeHealthCheckup(raw: unknown): HealthCheckupGeneratedContent {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid health checkup content response.');
  const o = raw as Record<string, unknown>;
  const systems = mergeHealthSystemsDemosWithLlmFields(o);
  return {
    overallSummary: clampText(o.overallSummary, MAX_OVERALL),
    followUpCare: clampText(o.followUpCare, MAX_FOLLOW_UP),
    recheckWithin1to2Weeks: clampStoredRecheckCard(o.recheckWithin1to2Weeks),
    recheckWithin1Month: clampStoredRecheckCard(o.recheckWithin1Month),
    recheckWithin3Months: clampStoredRecheckCard(o.recheckWithin3Months),
    recheckWithin6Months: clampStoredRecheckCard(o.recheckWithin6Months),
    ...(typeof o.labInterpretation === 'string' ? { labInterpretation: o.labInterpretation } : {}),
    ...systems,
  };
}

type Stage1Result = Pick<
  HealthCheckupGeneratedContent,
  'overallSummary' | 'followUpCare' | 'recheckWithin1to2Weeks' | 'recheckWithin1Month' | 'recheckWithin3Months' | 'recheckWithin6Months'
>;

function normalizeStage1(raw: unknown): Stage1Result {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid stage 1 response.');
  const o = raw as Record<string, unknown>;
  return {
    overallSummary: clampText(o.overallSummary, MAX_OVERALL),
    followUpCare: clampText(o.followUpCare, MAX_FOLLOW_UP),
    recheckWithin1to2Weeks: clampStoredRecheckCard(o.recheckWithin1to2Weeks),
    recheckWithin1Month: clampStoredRecheckCard(o.recheckWithin1Month),
    recheckWithin3Months: clampStoredRecheckCard(o.recheckWithin3Months),
    recheckWithin6Months: clampStoredRecheckCard(o.recheckWithin6Months),
  };
}

function isWithinPromptLength(content: HealthCheckupGeneratedContent): boolean {
  return content.overallSummary.length <= PROMPT_MAX_OVERALL && content.followUpCare.length <= PROMPT_MAX_FOLLOW_UP;
}

function trimAtSentenceBoundary(text: string, maxChars: number): string {
  const t = text.trim();
  if (t.length <= maxChars) return t;
  const sliced = t.slice(0, maxChars).trimEnd();
  const punct = ['.', '!', '?', '。', '！', '？'];
  let cut = -1;
  for (let i = sliced.length - 1; i >= 0; i -= 1) {
    if (punct.includes(sliced[i] ?? '')) {
      cut = i + 1;
      break;
    }
  }
  if (cut >= Math.floor(maxChars * 0.7)) return sliced.slice(0, cut).trim();
  return sliced.trim();
}

async function generateHealthCheckupRawJson(model: string, prompt: string, schemaHint?: string): Promise<unknown> {
  const hint = schemaHint ?? [
    'Required keys:',
    'overallSummary, followUpCare, recheckWithin1to2Weeks, recheckWithin1Month, recheckWithin3Months, recheckWithin6Months,',
    `${HEALTH_CHECKUP_SYSTEMS_LLM_FIELD_KEYS.join(', ')}, labInterpretation`,
    '',
    'Output rules:',
    '- Return exactly one JSON object (RFC8259). No markdown, no ``` fences, no commentary before or after.',
    '- Use UTF-8 JSON strings only; escape raw line breaks inside string values as \\n.',
  ].join(' ');
  const output = await geminiGenerateText(`${prompt}\n\n${hint}`, { maxOutputTokens: 16384 });
  if (!output.trim()) throw new Error('Gemini returned empty content.');
  try {
    const parsed = tryParseJsonObject(output);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Parsed JSON is not an object.');
    }
    return parsed;
  } catch {
    const preview = output.replace(/\s+/g, ' ').slice(0, 280);
    throw new Error(`Gemini returned non-JSON content. Preview: ${preview}`);
  }
}

export function parseHealthCheckupPayloadFromStorage(raw: unknown): HealthCheckupGeneratedContent {
  if (!raw || typeof raw !== 'object') return healthCheckupFromPlainObject({});
  return healthCheckupFromPlainObject(raw as Record<string, unknown>);
}

export type RegenerateSection =
  | 'overall'
  | 'followUp'
  | 'recheck'
  | 'systems3'
  | 'systems3b'
  | 'systems4'
  | 'systems5'
  | 'lab';

const VALID_REGENERATE_SECTIONS: readonly string[] = [
  'overall', 'followUp', 'recheck', 'systems3', 'systems3b', 'systems4', 'systems5', 'lab',
];

export function isRegenerateSection(s: string): s is RegenerateSection {
  return VALID_REGENERATE_SECTIONS.includes(s);
}

const SECTION_LLM_KEYS: Record<RegenerateSection, string[]> = {
  overall: ['overallSummary'],
  followUp: ['followUpCare'],
  recheck: ['recheckWithin1to2Weeks', 'recheckWithin1Month', 'recheckWithin3Months', 'recheckWithin6Months'],
  systems3: ['hp3_circ_dx', 'hp3_circ_imp', 'hp3_digest_dx', 'hp3_digest_imp', 'hp3_endo_dx', 'hp3_endo_imp'],
  systems3b: ['hp3_renal_uro_dx', 'hp3_renal_uro_imp', 'hp3_hepatobiliary_dx', 'hp3_hepatobiliary_imp', 'hp3_msk_dx', 'hp3_msk_imp'],
  systems4: ['hp4_dental_dx', 'hp4_dental_imp', 'hp4_skin_dx', 'hp4_skin_imp'],
  systems5: ['hp5_rad_interp', 'hp5_us_interp'],
  lab: ['labInterpretation'],
};

function buildSectionInstruction(
  section: RegenerateSection,
  opts: {
    programPrefixForPhrase: string;
    excludedAreaExactPhrase: string;
    checkupDate?: string;
    mustInclude?: string;
    overallContext?: string;
  },
): string {
  const { programPrefixForPhrase, excludedAreaExactPhrase, checkupDate, mustInclude, overallContext } = opts;
  void programPrefixForPhrase;
  const lines: string[] = [
    '너는 세계에서 가장 뛰어난 수의사야.',
    '아래 참고 데이터를 바탕으로 건강검진 보고서의 특정 섹션 하나만 재생성한다.',
    '응답은 유효한 JSON 객체 하나만. 마크다운 코드 펜스나 설명 문장 금지.',
    '모든 문장은 인쇄되어 보호자에게 전달되는 공식 건강검진 보고서 톤으로 작성한다.',
    '확정 진단·단정적 병명 단정은 피하고, 관찰 소견·해석 가능한 범위·권고 중심으로 쓴다.',
    '',
  ];
  if (overallContext) {
    lines.push(
      '========== 1단계 종합소견·사후관리 (스토리 일관성 참고용) ==========',
      overallContext,
      '',
    );
  }
  if (checkupDate) {
    lines.push(`검진일자: ${checkupDate} 데이터를 우선 참고한다.`, '');
  }
  if (mustInclude) {
    lines.push('반드시 포함:', mustInclude, '');
  }
  const fixedPhrase = `근거가 전혀 없는 칸: ${excludedAreaExactPhrase}`;
  switch (section) {
    case 'overall':
      lines.push(
        '========== 종합 소견 섹션만 재생성 ==========',
        '이번 검진으로 진단 또는 의심할 수 있는 내용을 문단별로 작성한다.',
        '질병이 여러 개라면 각 질병별로 문단을 나누어 설명하고, 핵심 근거자료를 관련 문단에 포함시킨다.',
        '차트 본문에서 의심된다고 언급된 질병은 크던 작던 반드시 근거와 함께 언급할 것.',
        '심각도 순으로 가장 심각한 것을 먼저, 가장 덜 심각한 것을 마지막에 써줄 것.',
        `글자 수: 공백 포함 최소 ${HEALTH_CHECKUP_PROMPT_MIN_OVERALL_CHARS}자 이상, 최대 ${HEALTH_CHECKUP_PROMPT_MAX_OVERALL_CHARS}자 이하.`,
        '출력 키: overallSummary (문자열)',
      );
      break;
    case 'followUp':
      lines.push(
        '========== 사후 관리 섹션만 재생성 ==========',
        '종합 소견에서 설명된 각 질환에 대해 앞으로 어떤 조치가 필요하고 병원에서 어떤 계획으로 대응할지 작성한다.',
        '질병이 여러 개라면 하나도 빠짐없이 각각에 대해 계획을 써줘. 보호자가 집에서 해야 할 사항도 포함한다.',
        `글자 수: 공백 포함 최소 ${HEALTH_CHECKUP_PROMPT_MIN_FOLLOW_UP_CHARS}자 이상, 최대 ${HEALTH_CHECKUP_PROMPT_MAX_FOLLOW_UP_CHARS}자 이하.`,
        '출력 키: followUpCare (문자열)',
      );
      break;
    case 'recheck':
      lines.push(
        '========== 권장 재검진 섹션만 재생성 ==========',
        '사후 관리에서 언급한 내용을 실제 액션 아이템으로 설명하는 부분이야.',
        `형식: 각 필드는 "제목(최대 ${HEALTH_CHECKUP_MAX_RECHECK_TITLE_CHARS}자)\\n본문(최대 ${HEALTH_CHECKUP_MAX_RECHECK_BODY_CHARS}자)"`,
        '해당 시기에 권장할 내용이 없으면 빈 문자열("")을 출력한다. 억지로 채우지 말 것.',
        `recheckWithin1to2Weeks: 가장 단기적인 액션 아이템 — 짧은 명사구 제목 + 문장 형태 본문`,
        `recheckWithin1Month: 1달 내 꼭 해야 할 액션 아이템`,
        `recheckWithin3Months: 3달 내 한 번쯤 짚어야 할 액션 아이템`,
        `recheckWithin6Months: 중장기 관리를 위한 액션 아이템`,
        '출력 키: recheckWithin1to2Weeks, recheckWithin1Month, recheckWithin3Months, recheckWithin6Months',
      );
      break;
    case 'systems3':
      lines.push(
        '========== 장기 시트 (순환기&호흡기 / 소화기 / 내분비) 섹션만 재생성 ==========',
        '아래 세 계통 각각에 대해 주요 진단(_dx)과 시사점(_imp)을 쌍으로 작성한다.',
        '· 주요 진단: 팩트 중심 — 검진에서 발견된 결과를 설명',
        '· 시사점: 보호자가 이해할 수 있는 임상적 의미와 관찰 포인트',
        '모든 관련 검사 결과가 정상이더라도 핵심 검사 결과를 인용하여 "이러이러하여 정상이다" 형식으로 써줘.',
        fixedPhrase,
        '',
        `[순환기&호흡기] hp3_circ_dx / hp3_circ_imp — 주요 진단 최대 ${HEALTH_CHECKUP_PROMPT_DENTAL_SKIN_DX_MAX_CHARS}자, 시사점 최대 ${HEALTH_CHECKUP_PROMPT_DENTAL_SKIN_IMP_MAX_CHARS}자`,
        '관련 질환: 심장병, 심비대, 폐렴, 기관지염, 기관허탈, 폐수종, 흉수, 폐 종괴 등',
        '인용 검사: 심장 크기, 폐 음영 증가 여부, 기관 협착, 흉수 여부, 심잡음, 호흡 패턴 이상',
        '',
        `[소화기] hp3_digest_dx / hp3_digest_imp — 주요 진단 최대 ${HEALTH_CHECKUP_PROMPT_DENTAL_SKIN_DX_MAX_CHARS}자, 시사점 최대 ${HEALTH_CHECKUP_PROMPT_DENTAL_SKIN_IMP_MAX_CHARS}자`,
        '관련 질환: 위염, 장염, 위장관 이물, 췌장염, 장 비후, 장 운동성 저하, 장 종괴 등',
        '인용 검사: 췌장염 수치, 단백 수치 변화, 위장관 비후, 장 운동성 감소, 장내 가스, 복강 내 이물',
        '',
        `[내분비계] hp3_endo_dx / hp3_endo_imp — 주요 진단 최대 ${HEALTH_CHECKUP_PROMPT_SYSTEMS_DX_MAX_CHARS}자, 시사점 최대 ${HEALTH_CHECKUP_PROMPT_SYSTEMS_IMP_MAX_CHARS}자`,
        '관련 질환: 당뇨병, 갑상선 기능 이상, 쿠싱증후군, 에디슨병, 비만 관련 대사 이상 등',
        '인용 검사: 혈당, 콜레스테롤, 중성지방, 호르몬 수치, 다음다뇨 여부, 식욕 변화',
        '',
        '출력 키: hp3_circ_dx, hp3_circ_imp, hp3_digest_dx, hp3_digest_imp, hp3_endo_dx, hp3_endo_imp',
      );
      break;
    case 'systems3b':
      lines.push(
        '========== 장기 시트 (신장·비뇨기 / 간담도 / 근골격) 섹션만 재생성 ==========',
        '아래 세 계통 각각에 대해 주요 진단(_dx)과 시사점(_imp)을 쌍으로 작성한다.',
        '· 주요 진단: 팩트 중심 — 검진에서 발견된 결과를 설명',
        '· 시사점: 보호자가 이해할 수 있는 임상적 의미와 관찰 포인트',
        '모든 관련 검사 결과가 정상이더라도 핵심 검사 결과를 인용하여 "이러이러하여 정상이다" 형식으로 써줘.',
        fixedPhrase,
        '',
        `[신장·비뇨기계] hp3_renal_uro_dx / hp3_renal_uro_imp — 최대 ${HEALTH_CHECKUP_PROMPT_SYSTEMS_DX_MAX_CHARS}자 / ${HEALTH_CHECKUP_PROMPT_SYSTEMS_IMP_MAX_CHARS}자`,
        '관련 질환: 신부전, 신장 결석, 방광 결석, 방광염, 요로 감염, 요로 확장, 단백뇨 등',
        '인용 검사: BUN, Creatinine, SDMA, 전해질 이상, 단백뇨, 혈뇨, 요비중 이상, 신장 크기·구조 변화, 결석, 방광벽 비후',
        '',
        `[간담도계] hp3_hepatobiliary_dx / hp3_hepatobiliary_imp — 최대 ${HEALTH_CHECKUP_PROMPT_SYSTEMS_DX_MAX_CHARS}자 / ${HEALTH_CHECKUP_PROMPT_SYSTEMS_IMP_MAX_CHARS}자`,
        '관련 질환: 간염, 지방간, 간 기능 저하, 담낭 슬러지, 담낭 점액종, 담석, 담관 폐색, 간 종괴 등',
        '인용 검사: ALT, AST, ALKP, GGT, 빌리루빈, 알부민, 간비대, 담낭 슬러지, 담관 확장 여부',
        '',
        `[근골격계] hp3_msk_dx / hp3_msk_imp — 최대 ${HEALTH_CHECKUP_PROMPT_SYSTEMS_DX_MAX_CHARS}자 / ${HEALTH_CHECKUP_PROMPT_SYSTEMS_IMP_MAX_CHARS}자`,
        '관련 질환: 관절염, 슬개골 탈구, 십자인대 손상, 고관절 이형성, 척추 질환, 디스크 질환, 골절, 근육 손상 등',
        '인용 검사: 관절 변형 여부, 관절 간격 감소, 골 증식, 골절 여부, 척추 정렬 이상',
        '',
        '출력 키: hp3_renal_uro_dx, hp3_renal_uro_imp, hp3_hepatobiliary_dx, hp3_hepatobiliary_imp, hp3_msk_dx, hp3_msk_imp',
      );
      break;
    case 'systems4':
      lines.push(
        '========== 치과 / 피부·외이도 섹션만 재생성 ==========',
        '아래 두 계통 각각에 대해 주요 진단(_dx)과 시사점(_imp)을 쌍으로 작성한다.',
        '· 주요 진단: 팩트 중심 — 검진에서 발견된 결과를 설명',
        '· 시사점: 보호자가 이해할 수 있는 임상적 의미와 관찰 포인트',
        '모든 관련 검사 결과가 정상이더라도 핵심 검사 결과를 인용하여 "이러이러하여 정상이다" 형식으로 써줘.',
        fixedPhrase,
        '',
        `[치과] hp4_dental_dx / hp4_dental_imp — 최대 ${HEALTH_CHECKUP_PROMPT_DENTAL_SKIN_DX_MAX_CHARS}자 / ${HEALTH_CHECKUP_PROMPT_DENTAL_SKIN_IMP_MAX_CHARS}자`,
        '관련 질환: 치석, 치주염, 치은염, 치아 흔들림, 치아 파절, 치근 농양, 구내염, 구강 종괴 등',
        '인용 검사: 치석 정도, 잇몸 염증 여부, 치아 흔들림·파절 여부, 구취 여부',
        '',
        `[피부·외이도] hp4_skin_dx / hp4_skin_imp — 최대 ${HEALTH_CHECKUP_PROMPT_DENTAL_SKIN_DX_MAX_CHARS}자 / ${HEALTH_CHECKUP_PROMPT_DENTAL_SKIN_IMP_MAX_CHARS}자`,
        '관련 질환(피부): 알레르기성 피부질환, 세균성 피부염, 진균성 피부염, 탈모, 피부 종괴, 습진 등',
        '관련 질환(외이도): 외이염, 귀 진드기 감염, 외이도 협착, 귀 분비물, 귀 냄새 증가 등 (강아지)',
        '인용 검사: 피부 상태, 귀 검사 결과 등 관련 소견',
        '',
        '출력 키: hp4_dental_dx, hp4_dental_imp, hp4_skin_dx, hp4_skin_imp',
      );
      break;
    case 'systems5':
      lines.push(
        '========== 방사선·초음파 섹션만 재생성 ==========',
        '포커스는 질병보다 **사진 상의 특이점** 위주로 설명한다. 어느 부위 이미지 상 어느 부분에서 어떤 특이점이 보이는지 구체적으로 써줘.',
        '보호자가 이해할 수 있도록 풀어서 설명도 함께 포함한다.',
        '장기별 섹션에서 이미 영상 결과를 인용했더라도 이 섹션에서 한 번 더 반복해도 된다.',
        fixedPhrase,
        '',
        `[방사선] hp5_rad_interp — 최대 ${HEALTH_CHECKUP_PROMPT_IMAGING_INTERP_MAX_CHARS}자`,
        '어느 부위 방사선 이미지 상 어느 부분에서 어떤 특이점이 보이는지 팩트 중심으로 설명해줘.',
        '',
        `[초음파] hp5_us_interp — 최대 ${HEALTH_CHECKUP_PROMPT_IMAGING_INTERP_MAX_CHARS}자`,
        '어느 부위 초음파 이미지 상 어느 부분에서 어떤 특이점이 보이는지 팩트 중심으로 설명해줘.',
        '',
        '출력 키: hp5_rad_interp, hp5_us_interp',
      );
      break;
    case 'lab':
      lines.push(
        '========== 혈액검사 해석 섹션만 재생성 ==========',
        '혈액검사 결과 페이지 상단에 들어가는 전체 해석 요약이야.',
        '임상적으로 의미 있는 이상 소견을 중심으로, 보호자가 이해할 수 있도록 해석해줘.',
        '정상 범위를 벗어난 항목들의 의미, 관련 질환 가능성, 주의사항 등을 간결하게 설명해줘.',
        '모든 수치가 정상이면 정상임을 알리되, 특히 유의할 점이 있으면 짧게 언급해줘.',
        `글자 수 제한: 공백 포함 최대 ${HEALTH_CHECKUP_PROMPT_LAB_INTERP_MAX_CHARS}자.`,
        '출력 키: labInterpretation (문자열)',
      );
      break;
  }
  return lines.join('\n');
}

function buildSectionPrompt(
  section: RegenerateSection,
  source: ReportSourceData,
  options?: { reportProgramName?: string; checkupDate?: string; mustInclude?: string },
  overallContext?: string,
): string {
  const programName = (options?.reportProgramName ?? '').trim();
  const programPrefixForPhrase = programName.length > 0 ? programName : '해당';
  const excludedAreaExactPhrase = `${programPrefixForPhrase} 프로그램 미포함 영역`;
  const checkupDate = options?.checkupDate?.trim() ?? '';
  const mustInclude = options?.mustInclude?.trim() ?? '';

  const chartSource = checkupDate ? source.chartBodyByDate.filter((c) => matchesCheckupDate(c.dateTime, checkupDate)) : source.chartBodyByDate;
  const labSource = checkupDate ? source.labItemsByDate.filter((d) => matchesCheckupDate(d.dateTime, checkupDate)) : source.labItemsByDate;
  const imageSource = checkupDate ? source.caseImages.filter((img) => matchesCheckupDate(img.examDate, checkupDate)) : source.caseImages;
  const vacSource = checkupDate
    ? source.vaccinationRecords.filter((v) => v.administeredDate != null && matchesCheckupDate(v.administeredDate, checkupDate))
    : source.vaccinationRecords;
  const physicalExamSource = checkupDate
    ? source.physicalExamItemsByDate.filter((d) => matchesCheckupDate(d.dateTime, checkupDate))
    : source.physicalExamItemsByDate;

  const chartLines = chartSource.slice(0, 20).map((c, i) => {
    const body = c.bodyText.slice(0, 10000);
    const plan = c.planText?.trim() ? ` [처방/플랜] ${c.planText.slice(0, 5000)}` : '';
    return `${i + 1}. ${c.dateTime} | ${body}${plan}`;
  });
  const labLines = labSource.slice(0, 20).map((d, i) => {
    const joined = d.items.slice(0, 15).map((x) => `${x.itemName}=${x.valueText}${x.unit ?? ''}(${x.flag})`).join(', ');
    return `${i + 1}. ${d.dateTime} | ${joined}`;
  });
  const vacLines = vacSource.slice(0, 30).map((v, i) => `${i + 1}. ${v.productName} | ${v.administeredDate ?? '-'} | ${v.recordType} ${v.doseOrder}`);
  const imageLines = imageSource.slice(0, 40).map((img, i) => {
    const label = examTypeLabel((img.examType as keyof typeof EXAM_TYPE_LABEL_KO) || 'other', img.radiologySub);
    return `${i + 1}. ${img.examDate} | ${label} | 주목=${img.hasNotableFinding ? '있음' : '없음'} | ${img.briefComment}`;
  });
  const physicalExamLines = physicalExamSource
    .flatMap((d) => d.items.map((item) => ({ dateTime: d.dateTime, ...item })))
    .filter((item) => !['nrf', 'normal', 'good', '양호', '정상'].includes(item.valueText.trim().toLowerCase()))
    .slice(0, 30)
    .map((item, i) => `${i + 1}. ${item.dateTime} | ${item.itemName} | ref=${item.referenceRange ?? '-'} | value=${item.valueText}${item.unit ? ` ${item.unit}` : ''}`);

  const instruction = buildSectionInstruction(section, {
    programPrefixForPhrase,
    excludedAreaExactPhrase,
    checkupDate: checkupDate || undefined,
    mustInclude: mustInclude || undefined,
    overallContext,
  });

  return [
    instruction,
    '',
    '========== 참고 데이터 ==========',
    '환자 기본 정보:',
    `- 병원: ${source.basicInfo?.hospitalName ?? '-'}`,
    `- 보호자: ${source.basicInfo?.ownerName ?? '-'}`,
    `- 환자명: ${source.basicInfo?.patientName ?? '-'}`,
    `- 종/품종: ${source.basicInfo?.species ?? '-'} / ${source.basicInfo?.breed ?? '-'}`,
    `- 생년월일/연령(참고): ${source.basicInfo?.birth ?? '-'} / ${source.basicInfo?.age != null ? `${source.basicInfo.age}` : '-'}`,
    '',
    '차트 본문(발췌):',
    ...(chartLines.length ? chartLines : ['(없음)']),
    '',
    '검사 수치(발췌):',
    ...(labLines.length ? labLines : ['(없음)']),
    '',
    '접종 기록(발췌):',
    ...(vacLines.length ? vacLines : ['(없음)']),
    '',
    '신체검사 특이사항(참고):',
    ...(physicalExamLines.length ? physicalExamLines : ['(특이사항 없음/데이터 없음)']),
    '',
    '이미지 분석 요약:',
    ...(imageLines.length ? imageLines : ['(이미지 없음)']),
  ].join('\n');
}

function normalizeSectionResponse(section: RegenerateSection, raw: unknown): Partial<HealthCheckupGeneratedContent> {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid section response shape.');
  const o = raw as Record<string, unknown>;
  switch (section) {
    case 'overall':
      return { overallSummary: clampText(o.overallSummary, MAX_OVERALL) };
    case 'followUp':
      return { followUpCare: clampText(o.followUpCare, MAX_FOLLOW_UP) };
    case 'recheck':
      return {
        recheckWithin1to2Weeks: clampStoredRecheckCard(o.recheckWithin1to2Weeks),
        recheckWithin1Month: clampStoredRecheckCard(o.recheckWithin1Month),
        recheckWithin3Months: clampStoredRecheckCard(o.recheckWithin3Months),
        recheckWithin6Months: clampStoredRecheckCard(o.recheckWithin6Months),
      };
    case 'systems3': {
      const merged = mergeHealthSystemsDemosWithLlmFields(o);
      return { systemsPage3Blocks: merged.systemsPage3Blocks };
    }
    case 'systems3b': {
      const merged = mergeHealthSystemsDemosWithLlmFields(o);
      return { systemsPage3bBlocks: merged.systemsPage3bBlocks };
    }
    case 'systems4': {
      const merged = mergeHealthSystemsDemosWithLlmFields(o);
      return { systemsPage4Blocks: merged.systemsPage4Blocks };
    }
    case 'systems5': {
      const merged = mergeHealthSystemsDemosWithLlmFields(o);
      return { systemsPage5Blocks: merged.systemsPage5Blocks };
    }
    case 'lab':
      return { labInterpretation: clampText(o.labInterpretation, HEALTH_CHECKUP_PROMPT_LAB_INTERP_MAX_CHARS) };
  }
}

export async function generateHealthCheckupSection(
  section: RegenerateSection,
  source: ReportSourceData,
  options?: { reportProgramName?: string; checkupDate?: string; mustInclude?: string },
  overallContext?: string,
): Promise<Partial<HealthCheckupGeneratedContent>> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured.');
  const model = process.env.GEMINI_REPORT_MODEL?.trim() || process.env.GEMINI_VISION_MODEL?.trim() || 'gemini-2.5-flash';
  void apiKey;

  const prompt = buildSectionPrompt(section, source, options, overallContext);
  const keys = SECTION_LLM_KEYS[section];
  const schemaHint = [
    `Required keys: ${keys.join(', ')}`,
    'Output rules:',
    '- Return exactly one JSON object (RFC8259). No markdown, no ``` fences, no commentary before or after.',
    '- Use UTF-8 JSON strings only; escape raw line breaks inside string values as \\n.',
  ].join('\n');

  void model;
  const output = await geminiGenerateText(`${prompt}\n\n${schemaHint}`, { maxOutputTokens: 16384 });
  if (!output.trim()) throw new Error('Gemini returned empty content.');

  let parsed: unknown;
  try {
    parsed = tryParseJsonObject(output);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Parsed JSON is not an object.');
    }
  } catch {
    const preview = output.replace(/\s+/g, ' ').slice(0, 280);
    throw new Error(`Gemini returned non-JSON content. Preview: ${preview}`);
  }

  return normalizeSectionResponse(section, parsed);
}

export async function generateHealthCheckupContent(
  source: ReportSourceData,
  options?: { reportProgramName?: string; checkupDate?: string; veterinarian?: string; mustInclude?: string },
): Promise<HealthCheckupGeneratedContent> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured.');
  const model = process.env.GEMINI_REPORT_MODEL?.trim() || process.env.GEMINI_VISION_MODEL?.trim() || 'gemini-2.5-flash';
  void apiKey;

  // Stage 1: generate backbone (overall + followUp + recheck)
  const stage1Prompt = buildHealthCheckupPrompt(source, options, { outputStage: 1 });
  const stage1SchemaHint = [
    'Required keys: overallSummary, followUpCare, recheckWithin1to2Weeks, recheckWithin1Month, recheckWithin3Months, recheckWithin6Months',
    'Output rules:',
    '- Return exactly one JSON object (RFC8259). No markdown, no ``` fences, no commentary before or after.',
    '- Use UTF-8 JSON strings only; escape raw line breaks inside string values as \\n.',
  ].join('\n');
  let stage1 = normalizeStage1(await generateHealthCheckupRawJson(model, stage1Prompt, stage1SchemaHint));

  // Trim stage1 backbone if it exceeds limits
  if (!isWithinPromptLength(stage1 as HealthCheckupGeneratedContent)) {
    const maxRetries = 2;
    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      const retryPrompt = [
        '다음 JSON의 의료 의미를 유지한 상태에서 길이만 조정하라.',
        `- overallSummary는 공백 포함 ${PROMPT_MAX_OVERALL}자 이하`,
        `- followUpCare는 공백 포함 ${PROMPT_MAX_FOLLOW_UP}자 이하`,
        '- 두 필드는 문장 중간에서 끊지 말고 완결 문장으로 마무리한다.',
        '- 재검진 카드 필드는 내용과 형식을 유지한다.',
        '- 출력은 유효한 JSON 객체 하나만 반환한다.',
        '',
        '입력 JSON:',
        JSON.stringify(stage1),
      ].join('\n');
      stage1 = normalizeStage1(await generateHealthCheckupRawJson(model, retryPrompt, stage1SchemaHint));
      if (isWithinPromptLength(stage1 as HealthCheckupGeneratedContent)) break;
    }
    if (!isWithinPromptLength(stage1 as HealthCheckupGeneratedContent)) {
      stage1 = {
        ...stage1,
        overallSummary: trimAtSentenceBoundary(stage1.overallSummary, PROMPT_MAX_OVERALL),
        followUpCare: trimAtSentenceBoundary(stage1.followUpCare, PROMPT_MAX_FOLLOW_UP),
      };
    }
  }

  // Stage 2: generate detail sections in parallel, injecting stage1 for consistency
  const overallContext = `종합소견:\n${stage1.overallSummary}\n\n사후관리:\n${stage1.followUpCare}`;
  const [s3, s3b, s4, s5, lab] = await Promise.all([
    generateHealthCheckupSection('systems3', source, options, overallContext),
    generateHealthCheckupSection('systems3b', source, options, overallContext),
    generateHealthCheckupSection('systems4', source, options, overallContext),
    generateHealthCheckupSection('systems5', source, options, overallContext),
    generateHealthCheckupSection('lab', source, options, overallContext),
  ]);

  return {
    ...stage1,
    ...s3,
    ...s3b,
    ...s4,
    ...s5,
    ...lab,
  };
}
