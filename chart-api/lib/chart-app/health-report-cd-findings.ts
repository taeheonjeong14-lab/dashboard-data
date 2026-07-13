import OpenAI from 'openai';
import type { PlacementImageInput } from '@/lib/chart-app/health-report-image-placement-llm';
import { signCaseImageStoragePaths } from '@/lib/chart-app/image-case-signing';
import { recordTokenUsage, openaiChatUsage, type UsageContext } from '@/lib/billing/usage-log';

/**
 * 건강검진 방사선·초음파(c/d) 검사소견: 종합소견을 맥락으로, 해당 모달리티 이미지를
 * "보고"(비전) 검사 소견 텍스트를 쓰고, 그 소견을 가장 잘 보여주는 이미지를 골라준다.
 * - dental(치아·구강) 방사선은 5p 치과 슬롯으로 가므로 여기 radiology 에서 제외한다.
 * - 이미지가 없으면 빈 결과(findings '', imageIds []).
 */
export type CdModalityResult = { findings: string; imageIds: string[] };
export type CdFindingsResult = { radiology: CdModalityResult; ultrasound: CdModalityResult };

async function runModality(
  client: OpenAI,
  model: string,
  modalityKo: string,
  images: PlacementImageInput[],
  overallSummary: string,
  maxSlots: number,
  usageContext?: UsageContext,
  opts?: { fillAll?: boolean; orderHint?: string; chartFindings?: string },
): Promise<CdModalityResult> {
  if (images.length === 0) return { findings: '', imageIds: [] };

  const signed = await signCaseImageStoragePaths(images.map((i) => i.storagePath));
  const urled = images
    .map((i) => ({ id: i.id, url: signed.get(i.storagePath) }))
    .filter((i): i is { id: string; url: string } => Boolean(i.url));
  if (urled.length === 0) return { findings: '', imageIds: [] };

  const validIds = new Set(urled.map((i) => i.id));
  const manifest = urled.map((i, idx) => `${idx}: id="${i.id}"`).join('\n');

  const prompt = [
    '너는 영상의학을 전공한 수의사다.',
    `아래 ${modalityKo} 검사 이미지를 보고, 건강검진 보고서에 들어갈 "${modalityKo} 검사 소견"을 한국어로 작성한다.`,
    '확정 진단·단정적 병명은 피하고 관찰 소견·해석 가능한 범위로 쓴다. 보호자가 읽는 글이니 쉬운 말로.',
    overallSummary ? `종합소견(맥락, 참고용):\n${overallSummary.slice(0, 1500)}` : '',
    opts?.chartFindings
      ? [
          '',
          `차트 기반 ${modalityKo} 소견 (진료기록에서 뽑은 것 — 반드시 반영):`,
          opts.chartFindings.slice(0, 1500),
        ].join('\n')
      : '',
    '',
    `★일관성 (가장 중요): 종합소견이나 위 차트 기반 소견에서 이 ${modalityKo} 검사로 확인했다고 한 진단·이상 소견은 **빠짐없이 이 소견에 포함**한다.`,
    '  첨부된 이미지에 그 소견이 안 보이더라도(그 부위 사진이 없거나 정지 영상이라 안 담겼을 수 있다) 검사에서 확인된 사실이므로 반드시 서술한다.',
    `  예: 종합소견에 "${modalityKo} 검사로 심장 판막 이상 확인"이 있는데 소견에서 심장을 아예 빼면, 앞뒤가 모순된 리포트가 된다.`,
    '  단, 이미지에도 없고 차트에도 없는 **새로운** 특이점을 지어내지는 말 것. 근거 있는 것만 쓴다.',
    '',
    'findings: 위 맥락(종합소견·차트 기반 소견)과 이미지 관찰을 함께 반영한 검사 소견 텍스트(2~5문장).',
    opts?.orderHint
      ? `imageIds: 이미지를 빼지 말고 **전부** id 배열에 담되, ${opts.orderHint} 순서로 정렬한다(최대 ${maxSlots}장, 아래 목록의 id 만). 방향(VD/lateral)과 부위(흉부/복부)는 이미지를 직접 보고 판단한다.`
      : `imageIds: 그 소견을 가장 잘 보여주는 이미지를 최대 ${maxSlots}장 골라 id 배열로(아래 목록의 id 만, 중요도 높은 순).`,
    '',
    '이미지 목록 (index: id):',
    manifest,
    '출력은 스키마에 맞는 JSON만.',
  ].filter(Boolean).join('\n');

  type Part = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
  const content: Part[] = [{ type: 'text', text: prompt }];
  for (const i of urled) content.push({ type: 'image_url', image_url: { url: i.url } });

  const response = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content }],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'cd_findings',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            findings: { type: 'string' },
            imageIds: { type: 'array', items: { type: 'string' } },
          },
          required: ['findings', 'imageIds'],
          additionalProperties: false,
        },
      },
    },
  });
  await recordTokenUsage({
    provider: 'openai',
    model,
    feature: 'image_findings',
    ...usageContext,
    ...openaiChatUsage(response.usage),
  });

  const raw = response.choices[0]?.message?.content;
  if (!raw) return { findings: '', imageIds: [] };
  let parsed: { findings?: unknown; imageIds?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { findings: '', imageIds: [] };
  }
  const findings = typeof parsed.findings === 'string' ? parsed.findings.trim() : '';
  const imageIds: string[] = [];
  for (const id of Array.isArray(parsed.imageIds) ? parsed.imageIds : []) {
    if (typeof id === 'string' && validIds.has(id) && !imageIds.includes(id)) imageIds.push(id);
    if (imageIds.length >= maxSlots) break;
  }
  // fillAll: LLM 이 일부만 골라도(흔함) 빠진 이미지를 순서대로 채워 "전부 배치" 보장.
  if (opts?.fillAll) {
    for (const i of urled) {
      if (imageIds.length >= maxSlots) break;
      if (!imageIds.includes(i.id)) imageIds.push(i.id);
    }
  }
  return { findings, imageIds };
}

/**
 * a/b 섹션(치과·안과 / 피부·외이도)에서 이미지가 슬롯보다 많을 때만 호출:
 * 섹션 생성 텍스트를 가장 잘 support 하는 이미지를 비전으로 골라 imageIds 반환(선택 전용).
 */
export async function selectSectionImages(params: {
  sectionLabel: string;
  sectionText: string;
  images: PlacementImageInput[];
  maxSlots: number;
  usageContext?: UsageContext;
}): Promise<string[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return params.images.slice(0, params.maxSlots).map((i) => i.id);
  if (params.images.length <= params.maxSlots) return params.images.map((i) => i.id);

  const model = process.env.OPENAI_VISION_MODEL?.trim() || 'gpt-4o';
  const client = new OpenAI({ apiKey });

  const signed = await signCaseImageStoragePaths(params.images.map((i) => i.storagePath));
  const urled = params.images
    .map((i) => ({ id: i.id, url: signed.get(i.storagePath) }))
    .filter((i): i is { id: string; url: string } => Boolean(i.url));
  if (urled.length === 0) return params.images.slice(0, params.maxSlots).map((i) => i.id);

  const validIds = new Set(urled.map((i) => i.id));
  const manifest = urled.map((i, idx) => `${idx}: id="${i.id}"`).join('\n');
  const prompt = [
    '너는 영상의학을 전공한 수의사다.',
    `건강검진 보고서 "${params.sectionLabel}" 섹션에 넣을 이미지를 고른다.`,
    `이 섹션 텍스트를 가장 잘 보여주는(support 하는) 이미지를 최대 ${params.maxSlots}장 골라 id 배열로 반환한다(중요도 높은 순).`,
    '',
    params.sectionText ? `섹션 텍스트:\n${params.sectionText.slice(0, 1500)}` : '(섹션 텍스트 없음 — 대표적인 이미지를 고른다)',
    '',
    '이미지 목록 (index: id):',
    manifest,
    '출력은 스키마에 맞는 JSON만.',
  ].join('\n');

  type Part = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
  const content: Part[] = [{ type: 'text', text: prompt }];
  for (const i of urled) content.push({ type: 'image_url', image_url: { url: i.url } });

  const response = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content }],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'section_image_selection',
        strict: true,
        schema: {
          type: 'object',
          properties: { imageIds: { type: 'array', items: { type: 'string' } } },
          required: ['imageIds'],
          additionalProperties: false,
        },
      },
    },
  });
  await recordTokenUsage({
    provider: 'openai',
    model,
    feature: 'image_placement',
    ...params.usageContext,
    ...openaiChatUsage(response.usage),
  });

  const raw = response.choices[0]?.message?.content;
  if (!raw) return params.images.slice(0, params.maxSlots).map((i) => i.id);
  let parsed: { imageIds?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return params.images.slice(0, params.maxSlots).map((i) => i.id);
  }
  const out: string[] = [];
  for (const id of Array.isArray(parsed.imageIds) ? parsed.imageIds : []) {
    if (typeof id === 'string' && validIds.has(id) && !out.includes(id)) out.push(id);
    if (out.length >= params.maxSlots) break;
  }
  return out.length ? out : params.images.slice(0, params.maxSlots).map((i) => i.id);
}

/**
 * @param chartFindings 차트 텍스트로 먼저 생성된 모달리티별 소견(hp5_rad_interp / hp5_us_interp).
 *   비전 소견이 이 칸을 덮어쓰기 때문에, 넘겨 주지 않으면 "초음파로 확인한 심장병"처럼
 *   차트에만 근거가 있는 소견이 통째로 사라져 리포트 앞뒤가 모순된다.
 */
export async function generateCdFindings(
  images: PlacementImageInput[],
  overallSummary: string,
  usageContext?: UsageContext,
  chartFindings?: { radiology?: string; ultrasound?: string },
): Promise<CdFindingsResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured.');
  const model = process.env.OPENAI_VISION_MODEL?.trim() || 'gpt-4o';
  const client = new OpenAI({ apiKey });

  // 치아·구강 방사선(dental)은 5p 치과 슬롯이므로 방사선 검사 소견에서 제외.
  const radImgs = images.filter((i) => i.examType === 'radiology' && i.radiologySub !== 'dental');
  const usImgs = images.filter((i) => i.examType === 'ultrasound');

  const [radiology, ultrasound] = await Promise.all([
    runModality(client, model, '방사선', radImgs, overallSummary, 4, usageContext, {
      fillAll: true,
      orderHint: 'VD 흉부 → lateral 흉부 → VD 복부 → lateral 복부',
      chartFindings: chartFindings?.radiology,
    }),
    runModality(client, model, '초음파', usImgs, overallSummary, 9, usageContext, {
      chartFindings: chartFindings?.ultrasound,
    }),
  ]);
  return { radiology, ultrasound };
}
