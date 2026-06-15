import type pg from 'pg';

import type { ExamType, RadiologySub } from '@/lib/chart-app/image-case-types';
import type { HealthCheckupValidatedPayload } from '@/lib/chart-app/health-checkup-content-schema';
import {
  DEMO_HEALTH_DENTAL_SKIN_BLOCKS,
  DEMO_RADIOLOGY_ULTRASOUND_BLOCKS,
  type HealthSystemsReportBlock,
} from '@/lib/chart-app/health-systems-demo-blocks';
import { type PlacementImageInput } from '@/lib/chart-app/health-report-image-placement-llm';
import { parseHealthSystemsBlocksFromUnknown } from '@/lib/chart-app/health-report-systems-blocks-parse';
import { generateCdFindings, selectSectionImages, type CdFindingsResult } from '@/lib/chart-app/health-report-cd-findings';
import { simpleHealthReportImageCaption } from '@/lib/chart-app/health-report-image-caption';
import type { UsageContext } from '@/lib/billing/usage-log';

type ImageRow = {
  id: string;
  exam_type: string;
  radiology_sub: string | null;
  body_part: string | null;
  storage_path: string;
};

/** run 의 케이스 이미지(라벨)를 읽어온다. 이미지가 없으면 null. (LLM 호출 없음 — DB 라벨만) */
async function loadCaseImages(
  client: pg.Pool | pg.PoolClient,
  runId: string,
): Promise<{ storagePathById: Map<string, string>; images: PlacementImageInput[] } | null> {
  const q = await client.query<ImageRow>(
    `select id, exam_type, radiology_sub, body_part, storage_path
     from chart_pdf.parse_run_case_images
     where parse_run_id = $1::uuid
     order by idx`,
    [runId],
  );
  const imageRows = q.rows ?? [];
  if (imageRows.length === 0) return null;

  const images: PlacementImageInput[] = imageRows.map((r) => ({
    id: r.id,
    examType: r.exam_type as ExamType,
    radiologySub: (r.radiology_sub as RadiologySub) ?? null,
    bodyPart: r.body_part ?? '',
    storagePath: r.storage_path,
  }));

  const storagePathById = new Map(images.map((i) => [i.id, i.storagePath]));
  return { storagePathById, images };
}

/** 라벨 기반 코드 배치(LLM 없음): 각 섹션 슬롯에 해당 검사종류 이미지를 순서대로 채운다. */
function placePage4ByLabel(
  page4: HealthSystemsReportBlock[],
  images: PlacementImageInput[],
  imageById: Map<string, PlacementImageInput>,
  storagePathById: Map<string, string>,
): void {
  const aIds = images.filter((i) => sectionABofImage(i) === 'a').map((i) => i.id);
  const bIds = images.filter((i) => sectionABofImage(i) === 'b').map((i) => i.id);
  fillImageBlock(page4[1], aIds, imageById, storagePathById); // 치과·안과(6)
  fillImageBlock(page4[3], bIds, imageById, storagePathById); // 피부·외이도(3)
}
function placePage5ByLabel(
  page5: HealthSystemsReportBlock[],
  images: PlacementImageInput[],
  imageById: Map<string, PlacementImageInput>,
  storagePathById: Map<string, string>,
): void {
  const cIds = images.filter((i) => i.examType === 'radiology' && i.radiologySub !== 'dental').map((i) => i.id);
  const dIds = images.filter((i) => i.examType === 'ultrasound').map((i) => i.id);
  fillImageBlock(page5[1], cIds, imageById, storagePathById); // 방사선(4)
  fillImageBlock(page5[3], dIds, imageById, storagePathById); // 초음파
}

function rowsTextOf(block: HealthSystemsReportBlock | undefined): string {
  if (!block || block.variant !== 'rows') return '';
  return block.rows.map((r) => r.content).filter(Boolean).join('\n');
}
function setRowsText(block: HealthSystemsReportBlock | undefined, content: string): void {
  if (!content || !block || block.variant !== 'rows') return;
  if (block.rows.length > 0) block.rows[0] = { label: block.rows[0].label ?? '', content };
  else block.rows = [{ label: '', content }];
}
function fillImageBlock(
  block: HealthSystemsReportBlock | undefined,
  ids: string[],
  imageById: Map<string, PlacementImageInput>,
  storagePathById: Map<string, string>,
): void {
  if (!block || !('images' in block)) return;
  const slots = block.images;
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (!slot) continue;
    const id = ids[i];
    const img = id ? imageById.get(id) : undefined;
    const path = id ? storagePathById.get(id) : undefined;
    slot.src = path;
    slot.caption = img && path ? simpleHealthReportImageCaption(img) : undefined;
  }
}

/** 이미지가 a(치과·안과) / b(피부·외이도) 섹션 후보인지 분류. 그 외는 null. */
function sectionABofImage(img: PlacementImageInput): 'a' | 'b' | null {
  const part = img.bodyPart || '';
  if (img.examType === 'radiology' && img.radiologySub === 'dental') return 'a';
  if (img.examType === 'slit_lamp') return 'a';
  if (img.examType === 'microscopy' || img.examType === 'endoscopy') return 'b';
  if (img.examType === 'other') {
    if (/구강|치아|잇몸|안구|안과|각막|결막|눈/.test(part)) return 'a';
    if (/피부|외이|귀|병변|털|발적/.test(part)) return 'b';
  }
  return null;
}

const CD_NOT_INCLUDED = '이번 검진 프로그램에는 포함되지 않은 영역입니다.';

/**
 * 방사선·초음파(c/d)는 "이미지를 보고 소견을 쓰는" 영역이라, 차트 텍스트로 소견을 쓰지 않는다.
 * - 해당 모달리티 이미지가 있으면: 비전 검사소견 + 선택 이미지.
 * - 이미지가 없으면: "포함되지 않은 영역" 문구 + 슬롯 비움.
 * (rows=page5[0]/page5[2], images=page5[1]/page5[3])
 */
function applyCdFindingsToPage5(
  page5: HealthSystemsReportBlock[],
  cd: CdFindingsResult,
  imageById: Map<string, PlacementImageInput>,
  storagePathById: Map<string, string>,
): void {
  const all = [...imageById.values()];
  const radCount = all.filter((i) => i.examType === 'radiology' && i.radiologySub !== 'dental').length;
  const usCount = all.filter((i) => i.examType === 'ultrasound').length;

  if (radCount === 0) {
    setRowsText(page5[0], CD_NOT_INCLUDED);
    fillImageBlock(page5[1], [], imageById, storagePathById);
  } else {
    setRowsText(page5[0], cd.radiology.findings);
    fillImageBlock(page5[1], cd.radiology.imageIds, imageById, storagePathById);
  }

  if (usCount === 0) {
    setRowsText(page5[2], CD_NOT_INCLUDED);
    fillImageBlock(page5[3], [], imageById, storagePathById);
  } else {
    setRowsText(page5[2], cd.ultrasound.findings);
    fillImageBlock(page5[3], cd.ultrasound.imageIds, imageById, storagePathById);
  }
}

export async function runImagePlacementForRun(
  client: pg.Pool | pg.PoolClient,
  runId: string,
  payload: HealthCheckupValidatedPayload,
  usageContext?: UsageContext,
): Promise<void> {
  // 이미지가 없어도 진행한다 — c/d(방사선·초음파)는 이미지 없으면 "포함되지 않은 영역" 문구를 넣어야 하므로.
  const loaded = await loadCaseImages(client, runId);
  const images = loaded?.images ?? [];
  const storagePathById = loaded?.storagePathById ?? new Map<string, string>();
  const imageById = new Map(images.map((i) => [i.id, i]));

  const page4 =
    parseHealthSystemsBlocksFromUnknown(payload.systemsPage4Blocks) ?? structuredClone(DEMO_HEALTH_DENTAL_SKIN_BLOCKS);
  const page5 =
    parseHealthSystemsBlocksFromUnknown(payload.systemsPage5Blocks) ?? structuredClone(DEMO_RADIOLOGY_ULTRASOUND_BLOCKS);

  // 1차: 라벨 기반 코드 배치(LLM 없음). 이후 c/d 비전·a/b 넘침이 덮어씀.
  placePage4ByLabel(page4, images, imageById, storagePathById);
  placePage5ByLabel(page5, images, imageById, storagePathById);

  // 방사선·초음파(c/d)는 항상 종합소견 맥락으로 이미지를 "보고" 검사소견 텍스트를 쓰고 이미지를 고른다.
  // (라벨 배치 위에 덮어쓴다. 이미지가 없는 모달리티는 기존 배치 유지.)
  try {
    const overallSummary = (payload as { overallSummary?: string }).overallSummary ?? '';
    const cd = await generateCdFindings(images, overallSummary, usageContext);
    applyCdFindingsToPage5(page5, cd, imageById, storagePathById);
  } catch (e) {
    console.error('[image-placement] c/d findings failed (non-blocking):', e);
  }

  // 치과·안과(a) / 피부·외이도(b)는 이미지가 슬롯보다 많을 때만 섹션 텍스트 기반 비전 선택으로 교체.
  try {
    const aImgs = images.filter((i) => sectionABofImage(i) === 'a');
    const bImgs = images.filter((i) => sectionABofImage(i) === 'b');
    if (aImgs.length > 6) {
      const ids = await selectSectionImages({ sectionLabel: '치과 및 안과', sectionText: rowsTextOf(page4[0]), images: aImgs, maxSlots: 6, usageContext });
      fillImageBlock(page4[1], ids, imageById, storagePathById);
    }
    if (bImgs.length > 3) {
      const ids = await selectSectionImages({ sectionLabel: '피부와 외이도', sectionText: rowsTextOf(page4[2]), images: bImgs, maxSlots: 3, usageContext });
      fillImageBlock(page4[3], ids, imageById, storagePathById);
    }
  } catch (e) {
    console.error('[image-placement] a/b overflow failed (non-blocking):', e);
  }

  payload.systemsPage4Blocks = page4;
  payload.systemsPage5Blocks = page5;
}

/**
 * 섹션 재생성(systems4=치과·피부 / systems5=방사선·초음파) 시, 갓 생성된 텍스트 블록에
 * 현재 run 의 케이스 이미지(나중에 추가된 것 포함)를 다시 배치한다.
 * - 데모 블록만 새로 만들면 이미지 슬롯이 비므로, 전체 생성과 동일한 배치를 한 페이지에만 적용한다.
 * - 이미지가 없으면 입력 블록을 그대로 돌려준다.
 */
export async function applyImagePlacementForSection(
  client: pg.Pool | pg.PoolClient,
  runId: string,
  section: 'systems4' | 'systems5',
  blocksUnknown: unknown,
  usageContext?: UsageContext,
  overallSummary = '',
): Promise<HealthSystemsReportBlock[]> {
  const blocks =
    parseHealthSystemsBlocksFromUnknown(blocksUnknown) ??
    structuredClone(
      section === 'systems4' ? DEMO_HEALTH_DENTAL_SKIN_BLOCKS : DEMO_RADIOLOGY_ULTRASOUND_BLOCKS,
    );

  const loaded = await loadCaseImages(client, runId);
  const images = loaded?.images ?? [];
  const storagePathById = loaded?.storagePathById ?? new Map<string, string>();
  const imageById = new Map(images.map((i) => [i.id, i]));

  // 재생성한 페이지에만 라벨 기반 코드 배치를 한 뒤, 전체 생성과 동일한 비전 단계를 적용한다.
  // (이미지가 없어도 c/d 는 "포함되지 않은 영역" 문구를 넣어야 하므로 그대로 진행.)
  if (section === 'systems4') {
    placePage4ByLabel(blocks, images, imageById, storagePathById);
    // a/b: 이미지가 슬롯보다 많을 때만 섹션 텍스트 기반 비전 선택.
    try {
      const aImgs = images.filter((i) => sectionABofImage(i) === 'a');
      const bImgs = images.filter((i) => sectionABofImage(i) === 'b');
      if (aImgs.length > 6) {
        const ids = await selectSectionImages({ sectionLabel: '치과 및 안과', sectionText: rowsTextOf(blocks[0]), images: aImgs, maxSlots: 6, usageContext });
        fillImageBlock(blocks[1], ids, imageById, storagePathById);
      }
      if (bImgs.length > 3) {
        const ids = await selectSectionImages({ sectionLabel: '피부와 외이도', sectionText: rowsTextOf(blocks[2]), images: bImgs, maxSlots: 3, usageContext });
        fillImageBlock(blocks[3], ids, imageById, storagePathById);
      }
    } catch (e) {
      console.error('[image-placement] a/b overflow (section) failed (non-blocking):', e);
    }
  } else {
    placePage5ByLabel(blocks, images, imageById, storagePathById);
    // c/d(방사선·초음파): 전체 생성과 동일하게 종합소견 맥락 비전으로 검사소견·이미지 재선택.
    try {
      const cd = await generateCdFindings(images, overallSummary, usageContext);
      applyCdFindingsToPage5(blocks, cd, imageById, storagePathById);
    } catch (e) {
      console.error('[image-placement] c/d findings (section) failed (non-blocking):', e);
    }
  }
  return blocks;
}
