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

  const response = await client.chat.completions.create({
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
