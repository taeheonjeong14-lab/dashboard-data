import type { HealthSystemsReportBlock } from '@/lib/chart-app/health-systems-demo-blocks';
import {
  DEMO_HEALTH_DENTAL_SKIN_BLOCKS,
  DEMO_HEALTH_SYSTEMS_BLOCKS,
  DEMO_HEALTH_SYSTEMS_PAGE_B_BLOCKS,
  DEMO_RADIOLOGY_ULTRASOUND_BLOCKS,
} from '@/lib/chart-app/health-systems-demo-blocks';


function str(s: unknown): string {
  return typeof s === 'string' ? s.trim() : '';
}

function cloneBlocks(blocks: readonly HealthSystemsReportBlock[]): HealthSystemsReportBlock[] {
  return structuredClone(blocks) as HealthSystemsReportBlock[];
}

function setRowContent(
  blocks: HealthSystemsReportBlock[],
  blockIndex: number,
  rowIndex: number,
  content: string,
): void {
  const b = blocks[blockIndex];
  if (b?.variant === 'rows' && b.rows[rowIndex]) {
    b.rows[rowIndex].content = content;
  }
}

const DISEASE_NAME_MAX = 60;

/** LLM이 출력한 질환명 배열 → 정리된 고유 이름 목록. */
function toDiseaseNames(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== 'string') continue;
    const n = x.trim().slice(0, DISEASE_NAME_MAX);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/** 장기 rows 블록에 질환 소개 후보 목록을 설정(본문은 토글 ON 시 생성, 초기엔 비활성). */
function setDiseaseOptions(blocks: HealthSystemsReportBlock[], blockIndex: number, names: string[]): void {
  if (names.length === 0) return;
  const b = blocks[blockIndex];
  if (b?.variant === 'rows') {
    b.diseaseOptions = names.map((name) => ({ name, body: '', enabled: false }));
  }
}

function joinLegacyDxImp(dx: unknown, imp: unknown): string {
  const a = str(dx);
  const b = str(imp);
  if (a && b) return `${a}\n\n${b}`;
  return a || b;
}

function coalesceMergedDxImp(merged: unknown, legacyA: unknown, legacyB: unknown): string {
  const primary = str(merged);
  if (primary) return primary;
  const a = str(legacyA);
  const b = str(legacyB);
  if (a && b) return `${a} ${b}`;
  return a || b;
}

export const HEALTH_CHECKUP_SYSTEMS_LLM_FIELD_KEYS = [
  'hp3_circ_dx',
  'hp3_circ_imp',
  'hp3_digest_dx',
  'hp3_digest_imp',
  'hp3_endo_dx',
  'hp3_endo_imp',
  'hp3_renal_uro_dx',
  'hp3_renal_uro_imp',
  'hp3_hepatobiliary_dx',
  'hp3_hepatobiliary_imp',
  'hp3_msk_dx',
  'hp3_msk_imp',
  'hp4_dental_dx',
  'hp4_dental_imp',
  'hp4_skin_dx',
  'hp4_skin_imp',
  'hp5_rad_interp',
  'hp5_us_interp',
] as const;

/**
 * vet-report와 동일: 데모 블록 클론 후 행 content만 LLM 문자열로 채움.
 * 블록 메타(titleKo/titleEn/이미지 슬롯 구조)는 데모 그대로 유지.
 */
export function mergeHealthSystemsDemosWithLlmFields(o: Record<string, unknown>): {
  systemsPage3Blocks: HealthSystemsReportBlock[];
  systemsPage3bBlocks: HealthSystemsReportBlock[];
  systemsPage4Blocks: HealthSystemsReportBlock[];
  systemsPage5Blocks: HealthSystemsReportBlock[];
} {
  const p3a = cloneBlocks(DEMO_HEALTH_SYSTEMS_BLOCKS);
  setRowContent(p3a, 0, 0, str(o.hp3_circ_dx));
  setRowContent(p3a, 0, 1, str(o.hp3_circ_imp));
  setRowContent(p3a, 1, 0, str(o.hp3_digest_dx));
  setRowContent(p3a, 1, 1, str(o.hp3_digest_imp));
  setRowContent(p3a, 2, 0, str(o.hp3_endo_dx));
  setRowContent(p3a, 2, 1, str(o.hp3_endo_imp));

  const renalUroDx = coalesceMergedDxImp(o.hp3_renal_uro_dx, o.hp3_renal_dx, o.hp3_uro_dx);
  const renalUroImp = coalesceMergedDxImp(o.hp3_renal_uro_imp, o.hp3_renal_imp, o.hp3_uro_imp);

  const p3b = cloneBlocks(DEMO_HEALTH_SYSTEMS_PAGE_B_BLOCKS);
  setRowContent(p3b, 0, 0, renalUroDx);
  setRowContent(p3b, 0, 1, renalUroImp);
  setRowContent(p3b, 1, 0, str(o.hp3_hepatobiliary_dx));
  setRowContent(p3b, 1, 1, str(o.hp3_hepatobiliary_imp));
  setRowContent(p3b, 2, 0, str(o.hp3_msk_dx));
  setRowContent(p3b, 2, 1, str(o.hp3_msk_imp));

  // 질환 소개 후보 목록(이름만) — LLM이 장기별 확진 질환명을 추린다. 본문은 admin 토글 ON 시 생성.
  setDiseaseOptions(p3a, 0, toDiseaseNames(o.hp3_circ_diseases));
  setDiseaseOptions(p3a, 1, toDiseaseNames(o.hp3_digest_diseases));
  setDiseaseOptions(p3a, 2, toDiseaseNames(o.hp3_endo_diseases));
  setDiseaseOptions(p3b, 0, toDiseaseNames(o.hp3_renal_uro_diseases));
  setDiseaseOptions(p3b, 1, toDiseaseNames(o.hp3_hepatobiliary_diseases));
  setDiseaseOptions(p3b, 2, toDiseaseNames(o.hp3_msk_diseases));

  const p4 = cloneBlocks(DEMO_HEALTH_DENTAL_SKIN_BLOCKS);
  setRowContent(p4, 0, 0, str(o.hp4_dental_dx));
  setRowContent(p4, 0, 1, str(o.hp4_dental_imp));
  setRowContent(p4, 2, 0, str(o.hp4_skin_dx));
  setRowContent(p4, 2, 1, str(o.hp4_skin_imp));
  // 5p 질환 소개 후보 — 치과 및 안과(block 0), 피부와 외이도(block 2)
  setDiseaseOptions(p4, 0, toDiseaseNames(o.hp4_dental_diseases));
  setDiseaseOptions(p4, 2, toDiseaseNames(o.hp4_skin_diseases));

  const p5 = cloneBlocks(DEMO_RADIOLOGY_ULTRASOUND_BLOCKS);
  const radInterp = str(o.hp5_rad_interp) || joinLegacyDxImp(o.hp5_rad_dx, o.hp5_rad_imp);
  const usInterp = str(o.hp5_us_interp) || joinLegacyDxImp(o.hp5_us_dx, o.hp5_us_imp);
  setRowContent(p5, 0, 0, radInterp);
  setRowContent(p5, 2, 0, usInterp);

  return {
    systemsPage3Blocks: p3a,
    systemsPage3bBlocks: p3b,
    systemsPage4Blocks: p4,
    systemsPage5Blocks: p5,
  };
}
