import OpenAI from 'openai';
import { recordOpenAiChatUsage, type UsageContext } from '@/lib/billing/usage-log';
import {
  EXAM_TYPES,
  RADIOLOGY_SUBS,
  type ExamType,
  type RadiologySub,
} from './types';

export type ImageInputPart = {
  buffer: Buffer;
  fileName: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
};

/**
 * 429(분당 토큰 한도)·일시적 5xx 는 지수 백오프로 재시도한다.
 * 단, "한 요청"이 분당 한도 자체를 넘으면 재시도로도 통과 못 하므로, 호출부에서 요청당 이미지 수를
 * 한도 아래로 쪼개 보내야 한다(아래 analyzeImageGroup 의 청크 처리). 여기서는 누적 TPM 페이싱을 담당.
 */
async function createChatWithRetry(
  client: OpenAI,
  params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  maxRetries = 5,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await client.chat.completions.create(params);
    } catch (e) {
      const status = (e as { status?: number })?.status;
      const retryable = status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
      if (!retryable || attempt >= maxRetries) throw e;
      const retryAfter = Number((e as { headers?: Record<string, string> })?.headers?.['retry-after']);
      const waitMs =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(20000, 800 * 2 ** attempt) + Math.floor(Math.random() * 400);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

// ── 날짜 그룹 단위 분석: 이미지 라벨(검사+부위) + 그룹 시사점(불렛+뒷받침 파일명) ──
export type GroupImageLabel = {
  index: number;
  fileName: string;
  examType: ExamType;
  bodyPart: string;
  /** examType이 radiology일 때만 세부 부위(흉부/복부/관절/치아). 아니면 null. */
  radiologySub: RadiologySub | null;
};
export type GroupBullet = {
  text: string;
  confidence: number;
  fileNames: string[];
  /** 파일명 → 이미지별 confidence(0~100). 그 이미지가 해당 질환을 얼마나 명확히 보여주는지. */
  imageConfidence?: Record<string, number>;
};
export type ImageGroupAnalysis = { images: GroupImageLabel[]; bullets: GroupBullet[] };

type RawGroupBullet = { text: string; confidence: number; supporting: { fileName: string; confidence: number }[] };

// 그룹 분석 1회 요청(이미지 한 청크). 라벨은 fileName 기준 Map, 불렛은 원시 형태로 반환(필터·병합은 호출부).
async function runImageGroupRequest(
  client: OpenAI,
  model: string,
  examDate: string,
  images: ImageInputPart[],
  usageContext?: UsageContext,
): Promise<{
  labelByFile: Map<string, { examType: ExamType; bodyPart: string; radiologySub: RadiologySub | null }>;
  rawBullets: RawGroupBullet[];
}> {
  const manifest = images.map((img, i) => `${i}: ${img.fileName}`).join('\n');

  const prompt = [
    '너는 세상에서 가장 실력 좋은 수의사야.',
    '수의 임상 이미지를 보고 각 이미지에 라벨(검사 종류·부위)을 붙인다. 출력은 스키마에 맞는 JSON만.',
    '검사일(지정됨, 추론·변경 금지): ' + (examDate || '(미지정)'),
    '',
    '[이미지 라벨] 각 이미지에 대해 딱 두 가지만 적는다(자세한 해석 금지):',
    '- examType: radiology / ultrasound / microscopy / endoscopy / slit_lamp / other 중 하나.',
    '- bodyPart: 검사 부위를 한국어로 짧게 (예: 흉부, 복부, 좌측 무릎, 구강, 우안). 불명확하면 "".',
    '- radiologySub: examType이 radiology일 때만 thorax(흉부)/abdomen(복부)/joint(관절)/dental(치아·구강) 중 가장 맞는 하나. radiology가 아니면 null. (치아·구강 X-ray는 반드시 dental)',
    '',
    '이미지 목록 (index: 파일명):',
    manifest,
  ].join('\n');

  type MessageContentPart =
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } };
  const content: MessageContentPart[] = [{ type: 'text', text: prompt }];
  for (const img of images) {
    content.push({
      type: 'image_url',
      image_url: { url: `data:${img.mimeType};base64,${img.buffer.toString('base64')}` },
    });
  }

  const response = await createChatWithRetry(client, {
    model,
    messages: [{ role: 'user', content }],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'image_group_analysis',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            images: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  index: { type: 'integer' },
                  fileName: { type: 'string' },
                  examType: { type: 'string', enum: [...EXAM_TYPES] },
                  bodyPart: { type: 'string' },
                  radiologySub: {
                    anyOf: [{ type: 'string', enum: [...RADIOLOGY_SUBS] }, { type: 'null' }],
                  },
                },
                required: ['index', 'fileName', 'examType', 'bodyPart', 'radiologySub'],
                additionalProperties: false,
              },
            },
          },
          required: ['images'],
          additionalProperties: false,
        },
      },
    },
  });
  await recordOpenAiChatUsage({ model, usage: response.usage, feature: 'image_analysis', ...(usageContext ?? {}) });

  const output = response.choices[0]?.message.content;
  if (!output) {
    const finishReason = response.choices[0]?.finish_reason ?? 'unknown';
    if (finishReason === 'content_filter') {
      throw new Error('이미지 메타데이터로 인해 분석이 차단되었습니다. 스크린샷 후 다시 업로드해 주세요.');
    }
    throw new Error(`이미지 분석에 실패했습니다. (finishReason: ${finishReason})`);
  }
  let parsed: { images?: unknown; bullets?: unknown };
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error('모델이 올바른 JSON 형식을 반환하지 않았습니다.');
  }

  // 라벨: 청크 내 index → fileName 으로 매핑(전역 순서는 호출부에서 fileName 기준으로 재구성).
  const labelByFile = new Map<string, { examType: ExamType; bodyPart: string; radiologySub: RadiologySub | null }>();
  for (const row of Array.isArray(parsed.images) ? parsed.images : []) {
    const o = row as Record<string, unknown>;
    const idx = typeof o.index === 'number' ? o.index : Number(o.index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= images.length) continue;
    const examType = EXAM_TYPES.includes(o.examType as ExamType) ? (o.examType as ExamType) : 'other';
    const bodyPart = typeof o.bodyPart === 'string' ? o.bodyPart.trim() : '';
    const radiologySub =
      examType === 'radiology' && RADIOLOGY_SUBS.includes(o.radiologySub as RadiologySub)
        ? (o.radiologySub as RadiologySub)
        : null;
    labelByFile.set(images[idx].fileName, { examType, bodyPart, radiologySub });
  }

  // 불렛: 원시 형태로만 반환(임계값·유효 파일명·상한·청크 간 병합은 analyzeImageGroup 에서).
  const rawBullets: RawGroupBullet[] = [];
  for (const row of Array.isArray(parsed.bullets) ? parsed.bullets : []) {
    const o = row as Record<string, unknown>;
    const text = typeof o.text === 'string' ? o.text.trim() : '';
    if (!text) continue;
    const confidence = Math.round(Number(o.confidence));
    const supporting: { fileName: string; confidence: number }[] = [];
    for (const it of Array.isArray(o.supportingImages) ? o.supportingImages : []) {
      const x = (it ?? {}) as Record<string, unknown>;
      const fn = typeof x.fileName === 'string' ? x.fileName : '';
      if (!fn) continue;
      let c = Math.round(Number(x.confidence));
      c = Number.isFinite(c) ? Math.max(0, Math.min(100, c)) : 0;
      supporting.push({ fileName: fn, confidence: c });
    }
    rawBullets.push({ text, confidence: Number.isFinite(confidence) ? confidence : 0, supporting });
  }

  return { labelByFile, rawBullets };
}

export async function analyzeImageGroup(params: {
  examDate: string;
  images: ImageInputPart[];
  usageContext?: UsageContext;
}): Promise<ImageGroupAnalysis> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured.');
  if (params.images.length === 0) return { images: [], bullets: [] };

  const model = process.env.OPENAI_VISION_MODEL?.trim() || 'gpt-4o';
  const client = new OpenAI({ apiKey });
  const validNames = new Set(params.images.map((i) => i.fileName));

  // 이미지가 많으면 한 요청 토큰이 분당 한도(TPM)를 넘어 429 가 난다(한 요청이 한도를 넘으면 재시도로도 불가).
  // 요청당 이미지 수를 제한해 청크로 나누고 순차로 보낸다(누적 TPM 페이싱은 createChatWithRetry 가 백오프로 담당).
  const maxPerReq = Number(process.env.CASE_GROUP_MAX_IMAGES_PER_REQUEST) || 10;
  const chunks: ImageInputPart[][] = [];
  for (let i = 0; i < params.images.length; i += maxPerReq) {
    chunks.push(params.images.slice(i, i + maxPerReq));
  }

  const labelByFile = new Map<string, { examType: ExamType; bodyPart: string; radiologySub: RadiologySub | null }>();
  const allRawBullets: RawGroupBullet[] = [];
  for (const chunk of chunks) {
    const r = await runImageGroupRequest(client, model, params.examDate, chunk, params.usageContext);
    for (const [fn, l] of r.labelByFile) labelByFile.set(fn, l);
    allRawBullets.push(...r.rawBullets);
  }

  const images: GroupImageLabel[] = params.images.map((img, index) => {
    const found = labelByFile.get(img.fileName);
    return {
      index,
      fileName: img.fileName,
      examType: found?.examType ?? 'other',
      bodyPart: found?.bodyPart ?? '',
      radiologySub: found?.radiologySub ?? null,
    };
  });

  // 불렛: 청크 간 동일 질환(text) 병합 → confidence 임계값 + 유효 파일명 + 질환당 이미지 상한.
  const minConfidence = Number(process.env.CASE_DISEASE_MIN_CONFIDENCE) || 70;
  const maxImagesPerDisease = Number(process.env.CASE_DISEASE_MAX_IMAGES) || 4;
  const mergedByText = new Map<string, { text: string; confidence: number; byFile: Map<string, number> }>();
  for (const b of allRawBullets) {
    if (!b.text) continue;
    if (!Number.isFinite(b.confidence) || b.confidence < minConfidence) continue;
    const key = b.text.replace(/\s+/g, ' ').toLowerCase();
    const entry = mergedByText.get(key) ?? { text: b.text, confidence: b.confidence, byFile: new Map<string, number>() };
    entry.confidence = Math.max(entry.confidence, b.confidence);
    for (const it of b.supporting) {
      if (!validNames.has(it.fileName)) continue;
      if (!entry.byFile.has(it.fileName) || it.confidence > (entry.byFile.get(it.fileName) ?? 0)) {
        entry.byFile.set(it.fileName, it.confidence);
      }
    }
    mergedByText.set(key, entry);
  }
  const bullets: GroupBullet[] = [...mergedByText.values()].map((e) => {
    const sorted = [...e.byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxImagesPerDisease);
    const fileNames = sorted.map(([fn]) => fn);
    const imageConfidence: Record<string, number> = {};
    for (const [fn, c] of sorted) imageConfidence[fn] = c;
    return { text: e.text, confidence: e.confidence, fileNames, imageConfidence };
  });

  return { images, bullets };
}

// per-image 정밀 분석(analyzeCaseImages / InBatches)은 그룹 분석으로 대체되어 제거됨.

// ── 진료케이스 4단계: 진단 기반 섹션별 이미지 선택 (영상의학 전공 수의사) ──────────
export type CaseBlogSectionInput = { id: string; label: string; keyText: string };
export type CaseBlogPatientInput = { species?: string; breed?: string; age?: string; sex?: string; name?: string };
export type CaseBlogImageAssignment = { sectionId: string; fileNames: string[] };

export async function analyzeCaseBlogImages(params: {
  patient: CaseBlogPatientInput;
  finalDiagnosis: string;
  contextText: string;
  sections: CaseBlogSectionInput[];
  images: (ImageInputPart & { examDate?: string | null })[];
  usageContext?: UsageContext;
}): Promise<{ assignments: CaseBlogImageAssignment[] }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured.');
  if (params.images.length === 0 || params.sections.length === 0) return { assignments: [] };

  const model = process.env.OPENAI_VISION_MODEL?.trim() || 'gpt-4o';
  const client = new OpenAI({ apiKey });
  const validNames = new Set(params.images.map((i) => i.fileName));
  const sectionIds = new Set(params.sections.map((s) => s.id));
  // 이미지는 진단 과정/치료 과정 섹션에만 배정. 그런 섹션이 있으면 그 id 로 제한(없으면 전체 허용=폴백).
  const isDiagOrTreat = (label: string) => label.includes('진단 과정') || label.includes('치료 과정');
  const scopedIds = new Set(params.sections.filter((s) => isDiagOrTreat(s.label)).map((s) => s.id));
  const allowedIds = scopedIds.size > 0 ? scopedIds : sectionIds;

  const manifest = params.images
    .map((img, i) => `${i}: ${img.fileName} | 날짜:${(img.examDate ?? '').toString().trim() || '미상'}`)
    .join('\n');
  const sectionsText = params.sections
    .map((s) => `- id="${s.id}" | ${s.label}\n    ${s.keyText.replace(/\s+/g, ' ').slice(0, 400)}`)
    .join('\n');
  const p = params.patient;
  const patientText = [p.species, p.breed, p.age, p.sex].map((x) => (x ?? '').toString().trim()).filter(Boolean).join(' / ') || '(정보 없음)';

  const prompt = [
    '너는 영상의학을 전공한 수의사다.',
    '아래 진료케이스의 이미지들을 "진단 과정 / 치료 과정" 섹션에만 골라 배정한다.',
    '확정 진단은 내리지 말고 이미지 관찰 근거로 고른다. 출력은 스키마에 맞는 JSON만.',
    '',
    `[환자] ${patientText}`,
    `[최종 진단명] ${params.finalDiagnosis || '(미기재)'}`,
    params.contextText ? `[내원 배경·진단 과정]\n${params.contextText.slice(0, 2000)}` : '',
    '',
    '[섹션 목록] (반드시 이 id 로만 배정)',
    sectionsText,
    '',
    '[이미지 목록] (index: 파일명 | 날짜)',
    manifest,
    '',
    '규칙:',
    '- 이미지는 "진단 과정" 섹션과 "치료 과정"(하위 섹션 포함) 섹션에만 배정한다. 그 외 섹션(인트로·질환 소개·내원 배경·사후 관리·원장님 한마디·아웃트로 등)에는 배정하지 않는다(빈 배열).',
    '- 진단 과정: 치료 전, 질환·이상 소견을 보여주는 이미지를 배정한다.',
    '- 치료 과정: 치료·수술 장면이나 치료된(호전된) 모습을 보여주는 이미지를 배정한다.',
    '- 치료 과정이 여러 하위 섹션으로 나뉘어 있으면, 각 이미지의 "날짜"를 보고 시간 흐름에 맞는 하위 섹션에 배정한다(예: 술 전 검사 → 수술 당일 → 수술 후 회복).',
    '- 특히 내과(약물·반복검사) 케이스는 치료 과정에서 호전 흐름을 보여주므로, 날짜 순서대로 중간중간 그 시점의 이미지를 배정한다.',
    '- 최종 진단명에 여러 질환이 있으면 각 질환을 가장 잘 보여주는 이미지를 해당 섹션에 배정한다.',
    '- 한 이미지는 가장 관련 깊은 한 섹션에만 배정한다(중복 금지). 맞는 이미지 없으면 그 섹션은 빈 배열.',
    '- fileNames 는 위 이미지 목록의 파일명만 사용한다(새 파일명 생성 금지).',
  ].filter(Boolean).join('\n');

  type MessageContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
  const content: MessageContentPart[] = [{ type: 'text', text: prompt }];
  for (const img of params.images) {
    content.push({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.buffer.toString('base64')}` } });
  }

  const response = await createChatWithRetry(client, {
    model,
    messages: [{ role: 'user', content }],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'case_blog_image_assignment',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            assignments: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  sectionId: { type: 'string' },
                  fileNames: { type: 'array', items: { type: 'string' } },
                },
                required: ['sectionId', 'fileNames'],
                additionalProperties: false,
              },
            },
          },
          required: ['assignments'],
          additionalProperties: false,
        },
      },
    },
  });
  await recordOpenAiChatUsage({ model, usage: response.usage, feature: 'blog_images', ...(params.usageContext ?? {}) });

  const output = response.choices[0]?.message.content;
  if (!output) throw new Error('이미지 배정에 실패했습니다.');
  let parsed: { assignments?: unknown };
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error('모델이 올바른 JSON 형식을 반환하지 않았습니다.');
  }

  // 후처리: 유효 섹션·파일명만, 한 이미지는 한 섹션에만(먼저 배정된 섹션 우선).
  const used = new Set<string>();
  const assignments: CaseBlogImageAssignment[] = [];
  for (const row of Array.isArray(parsed.assignments) ? parsed.assignments : []) {
    const o = (row ?? {}) as Record<string, unknown>;
    const sectionId = typeof o.sectionId === 'string' ? o.sectionId : '';
    // 유효 섹션이면서 진단/치료(허용) 섹션에만 배정(그 외 섹션은 LLM이 넣었어도 버린다).
    if (!sectionIds.has(sectionId) || !allowedIds.has(sectionId)) continue;
    const fileNames: string[] = [];
    for (const fn of Array.isArray(o.fileNames) ? o.fileNames : []) {
      if (typeof fn !== 'string' || !validNames.has(fn) || used.has(fn)) continue;
      used.add(fn);
      fileNames.push(fn);
    }
    assignments.push({ sectionId, fileNames });
  }
  return { assignments };
}
