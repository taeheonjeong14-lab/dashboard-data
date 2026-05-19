import type pg from 'pg';

import type { ExamType, RadiologySub } from '@/lib/chart-app/image-case-types';
import type { HealthCheckupValidatedPayload } from '@/lib/chart-app/health-checkup-content-schema';
import {
  DEMO_HEALTH_DENTAL_SKIN_BLOCKS,
  DEMO_RADIOLOGY_ULTRASOUND_BLOCKS,
} from '@/lib/chart-app/health-systems-demo-blocks';
import { applyImagePlacementToBlocks } from '@/lib/chart-app/health-report-image-placement-apply';
import { generateImagePlacement, type PlacementImageInput } from '@/lib/chart-app/health-report-image-placement-llm';
import { parseHealthSystemsBlocksFromUnknown } from '@/lib/chart-app/health-report-systems-blocks-parse';

type ImageRow = {
  id: string;
  exam_type: string;
  radiology_sub: string | null;
  brief_comment: string;
  has_notable_finding: boolean;
  related_assessment_condition: string | null;
  storage_path: string;
};

export async function runImagePlacementForRun(
  client: pg.Pool | pg.PoolClient,
  runId: string,
  payload: HealthCheckupValidatedPayload,
): Promise<void> {
  const q = await client.query<ImageRow>(
    `select id, exam_type, radiology_sub, brief_comment, has_notable_finding, related_assessment_condition, storage_path
     from chart_pdf.parse_run_case_images
     where parse_run_id = $1::uuid
     order by idx`,
    [runId],
  );
  const imageRows = q.rows ?? [];
  if (imageRows.length === 0) return;

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
  const placement = await generateImagePlacement(images);

  const page4 =
    parseHealthSystemsBlocksFromUnknown(payload.systemsPage4Blocks) ?? structuredClone(DEMO_HEALTH_DENTAL_SKIN_BLOCKS);
  const page5 =
    parseHealthSystemsBlocksFromUnknown(payload.systemsPage5Blocks) ?? structuredClone(DEMO_RADIOLOGY_ULTRASOUND_BLOCKS);

  applyImagePlacementToBlocks(page4, page5, placement, storagePathById);

  payload.systemsPage4Blocks = page4;
  payload.systemsPage5Blocks = page5;
}
