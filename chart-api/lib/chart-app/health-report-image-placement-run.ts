import type pg from 'pg';

import type { ExamType, RadiologySub } from '@/lib/chart-app/image-case-types';
import type { HealthCheckupValidatedPayload } from '@/lib/chart-app/health-checkup-content-schema';
import {
  DEMO_HEALTH_DENTAL_SKIN_BLOCKS,
  DEMO_RADIOLOGY_ULTRASOUND_BLOCKS,
  type HealthSystemsReportBlock,
} from '@/lib/chart-app/health-systems-demo-blocks';
import { applyImagePlacementToBlocks } from '@/lib/chart-app/health-report-image-placement-apply';
import {
  generateImagePlacement,
  type ImagePlacementResult,
  type PlacementImageInput,
} from '@/lib/chart-app/health-report-image-placement-llm';
import { parseHealthSystemsBlocksFromUnknown } from '@/lib/chart-app/health-report-systems-blocks-parse';
import { generateCdFindings, type CdFindingsResult } from '@/lib/chart-app/health-report-cd-findings';
import { simpleHealthReportImageCaption } from '@/lib/chart-app/health-report-image-caption';
import type { UsageContext } from '@/lib/billing/usage-log';

type ImageRow = {
  id: string;
  exam_type: string;
  radiology_sub: string | null;
  body_part: string | null;
  storage_path: string;
};

/** run 의 케이스 이미지를 읽어 배치 결과를 만든다. 이미지가 없으면 null. */
async function loadCaseImagePlacement(
  client: pg.Pool | pg.PoolClient,
  runId: string,
  usageContext?: UsageContext,
): Promise<{ placement: ImagePlacementResult; storagePathById: Map<string, string>; images: PlacementImageInput[] } | null> {
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
  const placement = await generateImagePlacement(images, usageContext);
  return { placement, storagePathById, images };
}

/** 방사선·초음파(c/d) 검사소견 비전 결과를 5p 블록에 반영 — rows 텍스트 + 이미지 슬롯. */
function applyCdFindingsToPage5(
  page5: HealthSystemsReportBlock[],
  cd: CdFindingsResult,
  images: PlacementImageInput[],
  storagePathById: Map<string, string>,
): void {
  const imageById = new Map(images.map((i) => [i.id, i]));
  const setRows = (block: HealthSystemsReportBlock | undefined, findings: string) => {
    if (!findings || !block || block.variant !== 'rows') return;
    if (block.rows.length > 0) block.rows[0] = { label: block.rows[0].label ?? '', content: findings };
    else block.rows = [{ label: '', content: findings }];
  };
  const fillImages = (block: HealthSystemsReportBlock | undefined, ids: string[]) => {
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
  };

  // 방사선: rows=page5[0], images4=page5[1] / 초음파: rows=page5[2], imagesGrid3x3=page5[3]
  if (cd.radiology.findings || cd.radiology.imageIds.length) {
    setRows(page5[0], cd.radiology.findings);
    fillImages(page5[1], cd.radiology.imageIds);
  }
  if (cd.ultrasound.findings || cd.ultrasound.imageIds.length) {
    setRows(page5[2], cd.ultrasound.findings);
    fillImages(page5[3], cd.ultrasound.imageIds);
  }
}

export async function runImagePlacementForRun(
  client: pg.Pool | pg.PoolClient,
  runId: string,
  payload: HealthCheckupValidatedPayload,
  usageContext?: UsageContext,
): Promise<void> {
  const loaded = await loadCaseImagePlacement(client, runId, usageContext);
  if (!loaded) return;
  const { placement, storagePathById, images } = loaded;

  const page4 =
    parseHealthSystemsBlocksFromUnknown(payload.systemsPage4Blocks) ?? structuredClone(DEMO_HEALTH_DENTAL_SKIN_BLOCKS);
  const page5 =
    parseHealthSystemsBlocksFromUnknown(payload.systemsPage5Blocks) ?? structuredClone(DEMO_RADIOLOGY_ULTRASOUND_BLOCKS);

  applyImagePlacementToBlocks(page4, page5, placement, storagePathById);

  // 방사선·초음파(c/d)는 항상 종합소견 맥락으로 이미지를 "보고" 검사소견 텍스트를 쓰고 이미지를 고른다.
  // (라벨 배치 위에 덮어쓴다. 이미지가 없는 모달리티는 기존 배치 유지.)
  try {
    const overallSummary = (payload as { overallSummary?: string }).overallSummary ?? '';
    const cd = await generateCdFindings(images, overallSummary, usageContext);
    applyCdFindingsToPage5(page5, cd, images, storagePathById);
  } catch (e) {
    console.error('[image-placement] c/d findings failed (non-blocking):', e);
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
): Promise<HealthSystemsReportBlock[]> {
  const blocks =
    parseHealthSystemsBlocksFromUnknown(blocksUnknown) ??
    structuredClone(
      section === 'systems4' ? DEMO_HEALTH_DENTAL_SKIN_BLOCKS : DEMO_RADIOLOGY_ULTRASOUND_BLOCKS,
    );

  const loaded = await loadCaseImagePlacement(client, runId, usageContext);
  if (!loaded) return blocks;
  const { placement, storagePathById } = loaded;

  // applyImagePlacementToBlocks 는 page4·page5 둘 다 받으므로, 재생성한 페이지에만 배치를
  // 반영하고 반대쪽은 버리는 데모 클론을 넘긴다.
  if (section === 'systems4') {
    applyImagePlacementToBlocks(
      blocks,
      structuredClone(DEMO_RADIOLOGY_ULTRASOUND_BLOCKS),
      placement,
      storagePathById,
    );
  } else {
    applyImagePlacementToBlocks(
      structuredClone(DEMO_HEALTH_DENTAL_SKIN_BLOCKS),
      blocks,
      placement,
      storagePathById,
    );
  }
  return blocks;
}
