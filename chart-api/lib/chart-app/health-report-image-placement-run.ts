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
import type { UsageContext } from '@/lib/billing/usage-log';

type ImageRow = {
  id: string;
  exam_type: string;
  radiology_sub: string | null;
  brief_comment: string;
  has_notable_finding: boolean;
  related_assessment_condition: string | null;
  storage_path: string;
};

/** run 의 케이스 이미지를 읽어 배치 결과를 만든다. 이미지가 없으면 null. */
async function loadCaseImagePlacement(
  client: pg.Pool | pg.PoolClient,
  runId: string,
  usageContext?: UsageContext,
): Promise<{ placement: ImagePlacementResult; storagePathById: Map<string, string> } | null> {
  const q = await client.query<ImageRow>(
    `select id, exam_type, radiology_sub, brief_comment, has_notable_finding, related_assessment_condition, storage_path
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
    briefComment: r.brief_comment ?? '',
    hasNotableFinding: Boolean(r.has_notable_finding),
    relatedAssessmentCondition: r.related_assessment_condition ?? null,
    storagePath: r.storage_path,
  }));

  const storagePathById = new Map(images.map((i) => [i.id, i.storagePath]));
  const placement = await generateImagePlacement(images, usageContext);
  return { placement, storagePathById };
}

export async function runImagePlacementForRun(
  client: pg.Pool | pg.PoolClient,
  runId: string,
  payload: HealthCheckupValidatedPayload,
  usageContext?: UsageContext,
): Promise<void> {
  const loaded = await loadCaseImagePlacement(client, runId, usageContext);
  if (!loaded) return;
  const { placement, storagePathById } = loaded;

  const page4 =
    parseHealthSystemsBlocksFromUnknown(payload.systemsPage4Blocks) ?? structuredClone(DEMO_HEALTH_DENTAL_SKIN_BLOCKS);
  const page5 =
    parseHealthSystemsBlocksFromUnknown(payload.systemsPage5Blocks) ?? structuredClone(DEMO_RADIOLOGY_ULTRASOUND_BLOCKS);

  applyImagePlacementToBlocks(page4, page5, placement, storagePathById);

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
