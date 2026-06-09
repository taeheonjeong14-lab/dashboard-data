import type { ExamType, RadiologySub } from '@/lib/chart-app/image-case-types';
import { EXAM_TYPE_LABEL_KO, RADIOLOGY_SUB_LABEL_KO } from '@/lib/chart-app/image-case-types';
import { geminiGenerateText, tryParseJsonObject } from '@/lib/chart-app/gemini';
import { simpleHealthReportImageCaption } from '@/lib/chart-app/health-report-image-caption';
import type { UsageContext } from '@/lib/billing/usage-log';

export type PlacementImageInput = {
  id: string;
  examType: ExamType;
  radiologySub: RadiologySub | null;
  briefComment: string;
  hasNotableFinding: boolean;
  relatedAssessmentCondition: string | null;
  storagePath: string;
};

export type PlacementSlot = {
  imageId: string;
  caption: string;
};

export type ImagePlacementResult = {
  dentalOphthalmology: (PlacementSlot | null)[];
  skinEar: (PlacementSlot | null)[];
  radiology: (PlacementSlot | null)[];
  ultrasound: (PlacementSlot | null)[];
};

function imageLabel(img: PlacementImageInput): string {
  const examKo = EXAM_TYPE_LABEL_KO[img.examType] ?? img.examType;
  const subKo = img.examType === 'radiology' && img.radiologySub ? RADIOLOGY_SUB_LABEL_KO[img.radiologySub] : null;
  const parts = [subKo ? `${examKo}(${subKo})` : examKo];
  if (img.hasNotableFinding) parts.push('소견있음');
  if (img.relatedAssessmentCondition) parts.push(`관련질환:${img.relatedAssessmentCondition}`);
  return parts.join(', ');
}

function normalizePlacement(raw: unknown, images: PlacementImageInput[]): ImagePlacementResult {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid placement response shape.');
  const o = raw as Record<string, unknown>;
  const imageIds = new Set(images.map((i) => i.id));
  const imageById = new Map(images.map((i) => [i.id, i]));

  function parseSlotArray(key: string, maxLen: number): (PlacementSlot | null)[] {
    const arr = o[key];
    if (!Array.isArray(arr)) return Array(maxLen).fill(null);
    const out: (PlacementSlot | null)[] = [];
    const usedIds = new Set<string>();
    for (let i = 0; i < maxLen; i++) {
      const item = arr[i];
      if (!item || typeof item !== 'object') {
        out.push(null);
        continue;
      }
      const slot = item as Record<string, unknown>;
      const id = typeof slot.imageId === 'string' ? slot.imageId.trim() : '';
      if (id && imageIds.has(id) && !usedIds.has(id)) {
        usedIds.add(id);
        const img = imageById.get(id);
        out.push({ imageId: id, caption: img ? simpleHealthReportImageCaption(img) : '' });
      } else {
        out.push(null);
      }
    }
    return out;
  }

  return {
    dentalOphthalmology: parseSlotArray('dentalOphthalmology', 6),
    skinEar: parseSlotArray('skinEar', 3),
    radiology: parseSlotArray('radiology', 4),
    ultrasound: parseSlotArray('ultrasound', 6),
  };
}

export async function generateImagePlacement(
  images: PlacementImageInput[],
  usageContext?: UsageContext,
): Promise<ImagePlacementResult> {
  if (images.length === 0) {
    return {
      dentalOphthalmology: [null, null, null, null, null, null],
      skinEar: [null, null, null],
      radiology: [null, null, null, null],
      ultrasound: [null, null, null, null, null, null],
    };
  }

  const manifest = images.map((img) => `- id="${img.id}" | ${imageLabel(img)} | ${img.briefComment}`).join('\n');

  const prompt = [
    '역할: 수의 건강검진 보고서 5페이지·6페이지에 삽입할 이미지를 골라 배치한다.',
    '아래는 이 케이스에 업로드된 이미지 목록이다. 각 이미지의 id, 검사 종류, 소견 유무, 캡션을 참고하여 적절한 슬롯에 배치하라.',
    '',
    '=== 이미지 목록 ===',
    manifest,
    '',
    '=== 보고서 이미지 슬롯 ===',
    '1. dentalOphthalmology (5p 치과 및 안과): 6칸(2행x3열). 치아 방사선(radiology+dental), 슬릿램프(slit_lamp), 안과·구강 관련 사진 배치. 해당 없으면 빈칸.',
    '2. skinEar (5p 피부와 외이도): 3칸. 현미경(microscopy) 중 피부·외이도 세포검사, 검이경(endoscopy), 피부 관련 사진. 해당 없으면 빈칸.',
    '3. radiology (6p 방사선 검사): 4칸. radiology(dental 제외) 사진. 흉부·복부 등 부위가 다양하면 골고루 배치. 소견 있는 이미지 우선.',
    '4. ultrasound (6p 초음파 검사): 6칸. ultrasound 사진. 소견 있는 이미지 우선, 다양한 장기 우선.',
    '',
    '=== 선택 가이드 ===',
    '- 이미지가 슬롯 수보다 많으면: hasNotableFinding=true인 이미지를 우선 배치. 그 다음은 부위(radiologySub) 다양성 확보.',
    '- 이미지가 슬롯 수보다 적으면: 남는 슬롯은 null(빈칸)로 두어라.',
    '- 해당 검사 종류의 이미지가 0장이면: 해당 섹션 전부 null.',
    '- 한 이미지를 두 섹션에 중복 배치하지 말 것.',
    '- other 타입 이미지: briefComment를 읽고 가장 관련 있는 섹션에 넣거나, 어디에도 맞지 않으면 배치하지 않는다.',
    '',
    '=== 캡션 가이드 ===',
    '- caption은 아주 간소하게 작성: 검사명·부위명 정도만 사용(한 줄, 20자 이내 권장).',
    '- 사진 소견/해석/진단 추정(예: 의심, 이상, 염증, 종괴, 비대, 정상 여부)은 캡션에 절대 쓰지 말 것.',
    '- 초음파는 가능하면 부위를 함께 표기(예: 복부 초음파, 간 초음파).',
    '- 일반 카메라(other)로 촬영한 치아·피부 병변 사진은 검사명 없이 부위명만 표기(예: 치아, 피부, 외이도).',
    '',
    '출력은 JSON 객체 하나만.',
    '키는 dentalOphthalmology, skinEar, radiology, ultrasound.',
    '각 키 값은 슬롯 배열이고 각 요소는 { "imageId": "...", "caption": "..." }.',
    '배치할 이미지가 없는 슬롯은 { "imageId": "", "caption": "" }.',
  ].join('\n');

  const raw = await geminiGenerateText(prompt, {
    maxOutputTokens: 4096,
    usageContext: { feature: 'image_placement', ...usageContext },
  });
  if (!raw?.trim()) throw new Error('Gemini returned empty placement content.');
  let parsed: unknown;
  try {
    parsed = tryParseJsonObject(raw);
  } catch {
    throw new Error('Gemini returned non-JSON placement content.');
  }
  return normalizePlacement(parsed, images);
}
