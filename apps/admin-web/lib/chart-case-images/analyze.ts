import OpenAI from 'openai';
import {
  EXAM_TYPES,
  RADIOLOGY_SUBS,
  type CaseImageAnalysis,
  type CaseImageItem,
  type ExamType,
  type FindingSpot,
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

function normalizeAnalysis(
  raw: unknown,
  expected: { index: number; fileName: string }[],
): CaseImageAnalysis {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid model response shape.');
  const root = raw as { images?: unknown };
  if (!Array.isArray(root.images)) throw new Error('Missing images array in model response.');

  const byIndex = new Map<number, CaseImageItem>();
  for (const row of root.images) {
    if (!row || typeof row !== 'object') continue;
    const o = row as Record<string, unknown>;
    const index = typeof o.index === 'number' ? o.index : Number(o.index);
    if (!Number.isInteger(index) || index < 0) continue;

    const fileName = typeof o.fileName === 'string' ? o.fileName : '';
    const examType = o.examType as string;
    const radiologySub = o.radiologySub as string | null | undefined;
    const hasNotableFinding = Boolean(o.hasNotableFinding);
    let briefComment = '';
    if (typeof o.briefComment === 'string') briefComment = o.briefComment.trim();

    if (!EXAM_TYPES.includes(examType as ExamType)) continue;
    let sub: RadiologySub | null = null;
    if (radiologySub != null && radiologySub !== '' && RADIOLOGY_SUBS.includes(radiologySub as RadiologySub)) {
      sub = radiologySub as RadiologySub;
    }
    if (examType !== 'radiology') sub = null;

    const isClearFinding = hasNotableFinding && Boolean(o.isClearFinding);

    let findingSpots: FindingSpot[] | undefined;
    if (hasNotableFinding && typeof o.findingSpotsStr === 'string' && o.findingSpotsStr.trim()) {
      const spots: FindingSpot[] = [];
      for (const pair of o.findingSpotsStr.split(';')) {
        const [cxRaw, cyRaw, rRaw] = pair.trim().split(',');
        const cx = Number(cxRaw?.trim());
        const cy = Number(cyRaw?.trim());
        const r = Math.max(2, Math.min(15, Number(rRaw?.trim()) || 6));
        if (Number.isFinite(cx) && Number.isFinite(cy) && cx >= 0 && cx <= 100 && cy >= 0 && cy <= 100) {
          spots.push({ cx, cy, r });
          if (spots.length >= 2) break;
        }
      }
      if (spots.length > 0) findingSpots = spots;
    }

    let relatedAssessmentCondition: string | null = null;
    const relRaw = typeof o.relatedConditionName === 'string' ? o.relatedConditionName.trim() : '';
    if (relRaw) relatedAssessmentCondition = relRaw;

    byIndex.set(index, {
      index,
      fileName,
      examType: examType as ExamType,
      radiologySub: sub,
      hasNotableFinding,
      isClearFinding,
      briefComment,
      findingSpots,
      relatedAssessmentCondition,
    });
  }

  const images: CaseImageItem[] = expected.map((exp) => {
    const found = byIndex.get(exp.index);
    if (found) return { ...found, fileName: exp.fileName };
    return {
      index: exp.index,
      fileName: exp.fileName,
      examType: 'other',
      radiologySub: null,
      hasNotableFinding: false,
      isClearFinding: false,
      briefComment: '',
      findingSpots: undefined,
      relatedAssessmentCondition: null,
    };
  });

  return { images };
}

export async function analyzeCaseImages(params: {
  examDate: string;
  images: ImageInputPart[];
}): Promise<CaseImageAnalysis> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured.');
  if (params.images.length === 0) throw new Error('No images to analyze.');

  const model = process.env.OPENAI_VISION_MODEL?.trim() || 'gpt-4o-mini';
  const client = new OpenAI({ apiKey });

  const manifest = params.images.map((img, i) => `${i}: ${img.fileName}`).join('\n');

  const prompt = [
    '역할: 수의 임상에서 영상·검사 사진을 1차로 나누어 보는 보조만 한다. 출력은 스키마에 맞는 JSON만.',
    '사용자가 한 번에 여러 이미지를 올렸다. 이미지마다 서로 다른 검사 유형일 수 있으니 각각 독립적으로 분류한다.',
    '확정 진단을 내리지 말 것. 관찰·가능성으로 표현하고, 최종 판단은 수의사가 한다.',
    '검사일(사용자가 지정함, 추론·변경 금지): ' + params.examDate,
    '',
    '아래 각 이미지에 대해 examType을 정확히 하나만 고른다:',
    '- radiology: X-ray, CT 출력, 방사선 사진. radiology면 radiologySub는 thorax·abdomen·joint·dental 중 가장 맞는 하나.',
    '- ultrasound: 초음파.',
    '- microscopy: 세포검사, 혈액도말, 현미경.',
    '- endoscopy: 내시경.',
    '- slit_lamp: 슬릿램프·안과 램프 검사 사진.',
    '- other: 위에 해당하지 않으면.',
    'examType이 radiology가 아니면 radiologySub는 null.',
    '',
    'hasNotableFinding: 눈에 띄는 이상·의심 소견이 있을 때만 true.',
    'isClearFinding: hasNotableFinding이 true이고 이상 소견이 매우 뚜렷하고 명확할 때만 true.',
    'findingSpotsStr: hasNotableFinding이 true이고 소견 위치가 명확히 특정될 때만 작성. 최대 2개. 형식: cx,cy,r을 세미콜론으로 구분. r은 2~15.',
    'briefComment: 한국어, 이미지당 짧은 문장 정확히 한 줄. 관찰 위주로 작성.',
    'relatedConditionName: 빈 문자열 ""로 고정.',
    '',
    'images 배열은 아래 목록과 동일하게 이미지마다 한 행, index는 0부터 n-1:',
    manifest,
  ]
    .filter(Boolean)
    .join('\n');

  type MessageContentPart =
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } };

  const content: MessageContentPart[] = [{ type: 'text', text: prompt }];
  for (const img of params.images) {
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
        name: 'case_image_analysis',
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
                  radiologySub: {
                    anyOf: [{ type: 'string', enum: [...RADIOLOGY_SUBS] }, { type: 'null' }],
                  },
                  hasNotableFinding: { type: 'boolean' },
                  isClearFinding: { type: 'boolean' },
                  briefComment: { type: 'string' },
                  findingSpotsStr: { type: 'string' },
                  relatedConditionName: { type: 'string', enum: [''] },
                },
                required: [
                  'index', 'fileName', 'examType', 'radiologySub',
                  'hasNotableFinding', 'isClearFinding', 'briefComment',
                  'findingSpotsStr', 'relatedConditionName',
                ],
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

  const output = response.choices[0]?.message.content;
  if (!output) {
    const finishReason = response.choices[0]?.finish_reason ?? 'unknown';
    if (finishReason === 'content_filter') {
      throw new Error('이미지 메타데이터로 인해 분석이 차단되었습니다. 스크린샷 후 다시 업로드해 주세요.');
    }
    throw new Error(`이미지 분석에 실패했습니다. (finishReason: ${finishReason})`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error('모델이 올바른 JSON 형식을 반환하지 않았습니다.');
  }

  return normalizeAnalysis(
    parsed,
    params.images.map((img, index) => ({ index, fileName: img.fileName })),
  );
}

// ── 날짜 그룹 단위 분석: 이미지 라벨(검사+부위) + 그룹 시사점(불렛+뒷받침 파일명) ──
export type GroupImageLabel = {
  index: number;
  fileName: string;
  examType: ExamType;
  bodyPart: string;
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
): Promise<{ labelByFile: Map<string, { examType: ExamType; bodyPart: string }>; rawBullets: RawGroupBullet[] }> {
  const manifest = images.map((img, i) => `${i}: ${img.fileName}`).join('\n');

  const prompt = [
    '너는 세상에서 가장 실력 좋은 수의사야.',
    '수의 임상 이미지를 보고 이미지 라벨과 의심 질환을 정리한다. 출력은 스키마에 맞는 JSON만.',
    '확정 진단은 내리지 말고 관찰·가능성으로 표현한다. 최종 판단은 담당 수의사가 한다.',
    '검사일(지정됨, 추론·변경 금지): ' + (examDate || '(미지정)'),
    '',
    '[이미지 라벨] 각 이미지에 대해 딱 두 가지만 적는다(자세한 해석 금지):',
    '- examType: radiology / ultrasound / microscopy / endoscopy / slit_lamp / other 중 하나.',
    '- bodyPart: 검사 부위를 한국어로 짧게 (예: 흉부, 복부, 좌측 무릎, 구강, 우안). 불명확하면 "".',
    '',
    '[의심 질환] 이 검사일의 이미지들로부터 "의심되는 질환"만 뽑아 bullets 에 담는다.',
    '- 각 불렛(text) = 의심 질환 하나 + 근거. 형식 예: "OOO 의심 — 이미지에서 △△, □□ 소견이 관찰되기 때문." 어떤 질환이 왜(이미지의 어떤 소견 때문에) 의심되는지를 한 문장으로.',
    '- 각 질환에 confidence(0~100 정수)를 매긴다 = 이미지 근거로 그 질환을 의심하는 확신도. 확실할수록 높게, 애매하면 낮게 정직하게 매긴다.',
    '- 이미지를 통해 의심해볼 수 있는 질환만 쓴다. "~을 확인할 수 있다", "~ 평가가 가능하다", "추가 검사가 필요하다" 같은 포괄적·일반적 서술은 절대 쓰지 않는다.',
    '- 각 불렛마다 그 질환을 뒷받침하는 이미지를 supportingImages 배열에 담는다. 각 원소 = { fileName(아래 목록의 파일명 그대로), confidence(0~100 정수) }.',
    '  · confidence = "그 이미지"가 해당 질환을 얼마나 명확히 보여주는지의 이미지별 확신도. 명확할수록 높게, 애매하면 낮게 정직하게.',
    '  · 한 질환당 최대 4장까지만. confidence 높은 순으로 가장 핵심적인 것만 엄선하고 4장을 초과하지 말 것. (너무 많으면 오히려 무분별해짐)',
    '- 의심되는 질환이 없으면 bullets 는 빈 배열로 둔다.',
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
                },
                required: ['index', 'fileName', 'examType', 'bodyPart'],
                additionalProperties: false,
              },
            },
            bullets: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  text: { type: 'string' },
                  confidence: { type: 'integer' },
                  supportingImages: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        fileName: { type: 'string' },
                        confidence: { type: 'integer' },
                      },
                      required: ['fileName', 'confidence'],
                      additionalProperties: false,
                    },
                  },
                },
                required: ['text', 'confidence', 'supportingImages'],
                additionalProperties: false,
              },
            },
          },
          required: ['images', 'bullets'],
          additionalProperties: false,
        },
      },
    },
  });

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
  const labelByFile = new Map<string, { examType: ExamType; bodyPart: string }>();
  for (const row of Array.isArray(parsed.images) ? parsed.images : []) {
    const o = row as Record<string, unknown>;
    const idx = typeof o.index === 'number' ? o.index : Number(o.index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= images.length) continue;
    const examType = EXAM_TYPES.includes(o.examType as ExamType) ? (o.examType as ExamType) : 'other';
    const bodyPart = typeof o.bodyPart === 'string' ? o.bodyPart.trim() : '';
    labelByFile.set(images[idx].fileName, { examType, bodyPart });
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

  const labelByFile = new Map<string, { examType: ExamType; bodyPart: string }>();
  const allRawBullets: RawGroupBullet[] = [];
  for (const chunk of chunks) {
    const r = await runImageGroupRequest(client, model, params.examDate, chunk);
    for (const [fn, l] of r.labelByFile) labelByFile.set(fn, l);
    allRawBullets.push(...r.rawBullets);
  }

  const images: GroupImageLabel[] = params.images.map((img, index) => {
    const found = labelByFile.get(img.fileName);
    return { index, fileName: img.fileName, examType: found?.examType ?? 'other', bodyPart: found?.bodyPart ?? '' };
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

/**
 * 이미지가 많을 때 한 번의 비전 호출에 전부 보내면 요청 크기·함수 타임아웃에 걸린다.
 * batchSize 장씩 나눠 concurrency 개씩 병렬 호출한 뒤 순서를 보존해 합친다.
 * (장수가 batchSize 이하면 단일 호출과 동일.)
 */
export async function analyzeCaseImagesInBatches(params: {
  examDate: string;
  images: ImageInputPart[];
  batchSize?: number;
  concurrency?: number;
}): Promise<CaseImageAnalysis> {
  const batchSize = Math.max(1, params.batchSize ?? 8);
  const concurrency = Math.max(1, params.concurrency ?? 4);
  const imgs = params.images;
  if (imgs.length <= batchSize) {
    return analyzeCaseImages({ examDate: params.examDate, images: imgs });
  }

  const chunks: ImageInputPart[][] = [];
  for (let i = 0; i < imgs.length; i += batchSize) {
    chunks.push(imgs.slice(i, i + batchSize));
  }

  const merged: CaseImageItem[] = [];
  for (let i = 0; i < chunks.length; i += concurrency) {
    const group = chunks.slice(i, i + concurrency);
    const results = await Promise.all(
      group.map((chunk) => analyzeCaseImages({ examDate: params.examDate, images: chunk })),
    );
    for (const r of results) merged.push(...r.images);
  }

  // 배치별 index(0..chunkLen-1)를 전역 0..n-1 로 재부여(순서 보존).
  return { images: merged.map((img, index) => ({ ...img, index })) };
}
