import type pg from 'pg';
import { logError } from '@dashboard/error-log';

import type { ExamType, RadiologySub } from '@/lib/chart-app/image-case-types';
import type { HealthCheckupValidatedPayload } from '@/lib/chart-app/health-checkup-content-schema';
import {
  DEMO_HEALTH_DENTAL_SKIN_BLOCKS,
  DEMO_RADIOLOGY_ULTRASOUND_BLOCKS,
  type HealthSystemsReportBlock,
} from '@/lib/chart-app/health-systems-demo-blocks';
import { type PlacementImageInput } from '@/lib/chart-app/health-report-image-placement-llm';
import { parseHealthSystemsBlocksFromUnknown } from '@/lib/chart-app/health-report-systems-blocks-parse';
import {
  generateCdFindings,
  selectSectionImages,
  type CdFindingsResult,
  type CdModalityResult,
} from '@/lib/chart-app/health-report-cd-findings';
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
  const cIds = sortRadiologyIds(
    images.filter((i) => i.examType === 'radiology' && i.radiologySub !== 'dental').map((i) => i.id),
    imageById,
  );
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

/**
 * 방사선 촬영 방향 — 정면(VD/DV) 0, 측면(lateral) 1, 불명 2.
 * 라벨에 전용 필드가 없어 bodyPart 자유문구에서 읽는다(라벨링 프롬프트가 "흉부 정면" 처럼 적게 한다).
 * 한국어·영문 약어를 모두 받는다 — 병원·라벨러에 따라 표기가 갈린다.
 */
function radiologyViewRank(bodyPart: string): number {
  const t = (bodyPart ?? '').toLowerCase();
  if (/정면|복배|배복|\bv\s*\/?\s*d\b|\bd\s*\/?\s*v\b/.test(t)) return 0;
  if (/측면|외측|\blat(eral)?\b|\brt?\s*lat\b|\blt?\s*lat\b/.test(t)) return 1;
  return 2;
}

/** 부위 순서 — 흉부 → 복부 → 관절 → 그 외. (치과 방사선은 상위에서 이미 제외됨) */
function radiologyPartRank(sub: RadiologySub | null): number {
  if (sub === 'thorax') return 0;
  if (sub === 'abdomen') return 1;
  if (sub === 'joint') return 2;
  return 3;
}

/**
 * 방사선 슬롯 채움 순서를 **코드로 확정**한다:
 *   흉부 정면 → 흉부 측면 → 복부 정면 → 복부 측면 → 관절(여러 장 가능) → 그 외
 *
 * 병원이 올리는 순서가 대체로 이 형태라 리포트도 같은 순서로 읽히는 게 자연스럽다.
 * 전에는 비전 프롬프트의 orderHint 로 "부탁"만 해서 매번 순서가 흔들렸다 — 선택(어떤 이미지를
 * 쓸지)과 소견 작성은 LLM 이 하되 **배치 순서는 우리가 정한다**.
 * 없는 부위는 자연히 건너뛰고 당겨 채워지며, 슬롯(4칸)이 차면 나머지는 fillImageBlock 이 버린다.
 * 동순위는 원래 순서를 유지한다(같은 부위·방향이 여러 장일 때 업로드 순서 보존).
 */
export function sortRadiologyIds(ids: string[], imageById: Map<string, PlacementImageInput>): string[] {
  return ids
    .map((id, idx) => ({ id, idx, img: imageById.get(id) }))
    .sort((a, b) => {
      const pa = radiologyPartRank(a.img?.radiologySub ?? null);
      const pb = radiologyPartRank(b.img?.radiologySub ?? null);
      if (pa !== pb) return pa - pb;
      // 관절 이하는 방향 구분이 의미 없어 업로드 순서를 그대로 둔다.
      if (pa <= 1) {
        const va = radiologyViewRank(a.img?.bodyPart ?? '');
        const vb = radiologyViewRank(b.img?.bodyPart ?? '');
        if (va !== vb) return va - vb;
      }
      return a.idx - b.idx;
    })
    .map((x) => x.id);
}

/**
 * 비전 단계 실패를 에러 로그에 올린다.
 *
 * 이 단계들은 전부 non-blocking 이다 — 실패해도 리포트는 그냥 생성되고, 라벨 기반 배치 결과나
 * 데모 블록이 남는다. 즉 **아무도 모르는 채로 품질만 조용히 떨어진다**. console.error 는
 * Vercel 로그에만 남아 사실상 안 본다. 리포트에서 제일 눈에 띄는 부분이라 반드시 올린다.
 */
async function logVisionFailure(
  stage: string,
  runId: string,
  e: unknown,
  usageContext?: UsageContext,
): Promise<void> {
  await logError({
    app: 'chart-api',
    source: 'server',
    route: '/lib/chart-app/health-report-image-placement-run',
    feature: 'image_placement',
    message: `${stage}: ${e instanceof Error ? e.message : String(e)}`,
    stack: e instanceof Error ? e.stack ?? null : null,
    hospitalId: usageContext?.hospitalId ?? null,
    context: { runId, stage, model: process.env.IMAGE_VISION_MODEL?.trim() || 'xai/grok-4.5' },
  });
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

/** 텍스트가 "미포함 영역" 고정 문구인지(= 차트에도 근거가 없다는 뜻). */
function isNotIncludedText(s: string): boolean {
  return !s.trim() || /미포함 영역|포함되지 않은 영역/.test(s);
}

/**
 * 방사선·초음파(c/d) 검사소견 반영.
 * - 이미지가 있으면: 비전 검사소견 + 선택 이미지(차트 소견은 비전 프롬프트에 이미 반영됨).
 * - 이미지가 없어도 차트 기반 소견이 있으면: 그 텍스트를 살린다(슬롯만 비움).
 *   ※ 사진 없이 판독 결과만 차트에 적힌 경우가 있다(예: 정형 방사선 소견이 종합소견엔 있는데 사진 미첨부).
 *     예전에는 이미지 0장이면 무조건 "포함되지 않은 영역"으로 덮어써서, 재생성해도 그 문구가 안 없어졌다.
 * - 이미지도 없고 차트 근거도 없을 때만: "포함되지 않은 영역" 문구.
 * (rows=page5[0]/page5[2], images=page5[1]/page5[3])
 */
function applyCdFindingsToPage5(
  page5: HealthSystemsReportBlock[],
  cd: CdFindingsResult,
  imageById: Map<string, PlacementImageInput>,
  storagePathById: Map<string, string>,
  chartFindings?: { radiology?: string; ultrasound?: string },
): void {
  const all = [...imageById.values()];
  const radCount = all.filter((i) => i.examType === 'radiology' && i.radiologySub !== 'dental').length;
  const usCount = all.filter((i) => i.examType === 'ultrasound').length;

  const applyModality = (
    rowsBlock: HealthSystemsReportBlock | undefined,
    imagesBlock: HealthSystemsReportBlock | undefined,
    count: number,
    vision: CdModalityResult,
    chartText: string,
    isRadiology: boolean,
  ) => {
    if (count > 0) {
      setRowsText(rowsBlock, vision.findings);
      // 방사선만 배치 순서를 코드로 확정한다(흉부 정면·측면 → 복부 정면·측면 → 관절).
      // 초음파는 정해진 순서가 없어 비전이 고른 순서(이상 소견 우선)를 그대로 쓴다.
      const ids = isRadiology ? sortRadiologyIds(vision.imageIds, imageById) : vision.imageIds;
      fillImageBlock(imagesBlock, ids, imageById, storagePathById);
      return;
    }
    // 이미지 없음 — 차트 기반 소견이 있으면 살리고, 없으면 미포함 문구.
    setRowsText(rowsBlock, isNotIncludedText(chartText) ? CD_NOT_INCLUDED : chartText);
    fillImageBlock(imagesBlock, [], imageById, storagePathById);
  };

  applyModality(page5[0], page5[1], radCount, cd.radiology, chartFindings?.radiology ?? '', true);
  applyModality(page5[2], page5[3], usCount, cd.ultrasound, chartFindings?.ultrasound ?? '', false);
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
    // 덮어쓰기 전에 차트 텍스트로 쓴 소견(hp5_*_interp)을 떠서 비전 프롬프트에 넘긴다 —
    // 안 그러면 "초음파로 확인한 심장병"처럼 이미지엔 안 보이고 차트에만 있는 소견이 통째로 사라진다.
    const chartFindings = {
      radiology: rowsTextOf(page5[0]),
      ultrasound: rowsTextOf(page5[2]),
    };
    const cd = await generateCdFindings(images, overallSummary, usageContext, chartFindings);
    applyCdFindingsToPage5(page5, cd, imageById, storagePathById, chartFindings);
  } catch (e) {
    console.error('[image-placement] c/d findings failed (non-blocking):', e);
    await logVisionFailure('c/d 검사소견(전체 생성)', runId, e, usageContext);
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
    await logVisionFailure('a/b 이미지 넘침 선택(전체 생성)', runId, e, usageContext);
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
      await logVisionFailure('a/b 이미지 넘침 선택(섹션 재생성)', runId, e, usageContext);
    }
  } else {
    placePage5ByLabel(blocks, images, imageById, storagePathById);
    // c/d(방사선·초음파): 전체 생성과 동일하게 종합소견 맥락 비전으로 검사소견·이미지 재선택.
    try {
      // 갓 생성된 차트 기반 소견을 덮어쓰기 전에 떠서 비전에 넘긴다(전체 생성과 동일).
      const chartFindings = { radiology: rowsTextOf(blocks[0]), ultrasound: rowsTextOf(blocks[2]) };
      const cd = await generateCdFindings(images, overallSummary, usageContext, chartFindings);
      applyCdFindingsToPage5(blocks, cd, imageById, storagePathById, chartFindings);
    } catch (e) {
      console.error('[image-placement] c/d findings (section) failed (non-blocking):', e);
      await logVisionFailure('c/d 검사소견(섹션 재생성)', runId, e, usageContext);
    }
  }
  return blocks;
}
