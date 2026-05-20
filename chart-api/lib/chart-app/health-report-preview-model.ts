import type { ReportSourceData } from '@/lib/chart-app/report-types';
import type { HealthCheckupGeneratedContent } from '@/lib/chart-app/health-checkup-content-llm';
import type { HealthSystemsReportBlock } from '@/lib/chart-app/health-systems-demo-blocks';
import type { HospitalRow } from '@/lib/chart-app/hospitals-types';
import {
  DEMO_HEALTH_DENTAL_SKIN_BLOCKS,
  DEMO_HEALTH_SYSTEMS_BLOCKS,
  DEMO_HEALTH_SYSTEMS_PAGE_B_BLOCKS,
  DEMO_RADIOLOGY_ULTRASOUND_BLOCKS,
} from '@/lib/chart-app/health-systems-demo-blocks';
import { parseHealthSystemsBlocksFromUnknown } from '@/lib/chart-app/health-report-systems-blocks-parse';
import { resolveHospitalReportTemplate } from '@/lib/chart-app/report-hospital-template';
import { formatDirectorHospitalLine, spreadKoreanCharsForFooter } from '@/lib/chart-app/report-director-line';
import { labItemCategory, detectSpeciesProfile, labCategorySortOrder } from '@/lib/lab-category-map';
import { refineLabFlag } from '@dashboard/lab-normalize';

export type LabReportPage = { groups: unknown[] };

export type HealthReportPreviewModel = {
  hospital: HospitalRow | null;
  coverProps: Record<string, unknown>;
  summaryProps: Record<string, unknown>;
  outerCoverProps: Record<string, unknown>;
  tokenOverrides: Record<string, string> | null;
  systemsPage3Blocks: HealthSystemsReportBlock[];
  systemsPage3bBlocks: HealthSystemsReportBlock[];
  systemsPage4Blocks: HealthSystemsReportBlock[];
  systemsPage5Blocks: HealthSystemsReportBlock[];
  labPages: LabReportPage[];
  labInterpretation: string;
};

function splitTimelineCardText(raw: string): { cardTitle: string; cardBody: string } {
  const s = (raw ?? '').trim();
  if (!s) return { cardTitle: '', cardBody: '' };
  const nl = s.indexOf('\n');
  if (nl === -1) return { cardTitle: '', cardBody: s };
  return { cardTitle: s.slice(0, nl).trim(), cardBody: s.slice(nl + 1).trim() };
}

function timelineItemsFromGenerated(g: HealthCheckupGeneratedContent): Array<Record<string, string>> {
  const rows: Array<[string, string]> = [
    ['1-2주 이내', g.recheckWithin1to2Weeks],
    ['1개월 이내', g.recheckWithin1Month],
    ['3개월 이내', g.recheckWithin3Months],
    ['6개월 이내', g.recheckWithin6Months],
  ];
  return rows.map(([intervalLabel, raw]) => {
    const { cardTitle, cardBody } = splitTimelineCardText(raw ?? '');
    return { intervalLabel, cardTitle, cardBody };
  });
}

function safeTrim(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function nonEmptyOr(a: string, b: string): string {
  return a.trim() ? a.trim() : b.trim();
}

function formatKoreanDateLine(raw: string): string {
  const t = raw.trim();
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return t;
  return `${m[1]}년 ${m[2]}월 ${m[3]}일`;
}

function speciesLabelFromText(raw: string | null | undefined): 'DOG' | 'CAT' {
  const t = (raw ?? '').toLowerCase();
  if (t.includes('cat') || t.includes('feline') || t.includes('고양') || t.includes('묘')) return 'CAT';
  return 'DOG';
}

function coverPetImageFromSpecies(speciesLabel: 'DOG' | 'CAT'): string {
  const cat = (process.env.REPORT_CAT_COVER_URL ?? '').trim();
  const dog = (process.env.REPORT_DOG_COVER_URL ?? '').trim();
  if (speciesLabel === 'CAT') return cat || '/cat_cover.png';
  return dog || '/dog_cover.png';
}

const LAB_ITEMS_PER_PAGE = 50;

function buildLabPages(source: ReportSourceData, speciesStr: string): LabReportPage[] {
  // Flatten across dates; last occurrence per item name wins (most recent value).
  const flat = new Map<string, { itemName: string; valueText: string; unit: string | null; referenceRange: string | null; flag: 'low' | 'high' | 'normal' | 'unknown' }>();
  for (const dateGroup of source.labItemsByDate) {
    for (const item of dateGroup.items) {
      if (item.itemName.trim()) flat.set(item.itemName, item);
    }
  }
  if (flat.size === 0) return [];

  const species = detectSpeciesProfile(speciesStr);
  const groupsByKey = new Map<string, { categoryKey: string; categoryLabel: string; items: unknown[] }>();
  for (const item of flat.values()) {
    const cat = labItemCategory(item.itemName, species);
    const flag = refineLabFlag(item.flag, item.valueText, item.referenceRange);
    const g = groupsByKey.get(cat.key) ?? { categoryKey: cat.key, categoryLabel: cat.label, items: [] };
    g.items.push({ ...item, flag, categoryKey: cat.key, categoryLabel: cat.label });
    groupsByKey.set(cat.key, g);
  }

  const sorted = [...groupsByKey.values()].sort(
    (a, b) => labCategorySortOrder(a.categoryKey) - labCategorySortOrder(b.categoryKey),
  );

  const pages: LabReportPage[] = [];
  let pageGroups: typeof sorted = [];
  let pageItems = 0;
  for (const group of sorted) {
    if (pageItems > 0 && pageItems + group.items.length > LAB_ITEMS_PER_PAGE) {
      pages.push({ groups: pageGroups });
      pageGroups = [];
      pageItems = 0;
    }
    pageGroups.push(group);
    pageItems += group.items.length;
  }
  if (pageGroups.length > 0) pages.push({ groups: pageGroups });
  return pages;
}

/**
 * vet-report 패리티 목표의 “preview model 조립”.
 * - coverProps/summaryProps/outerCoverProps는 프론트 컴포넌트가 기대하는 키(hospitalName/Logo 등)는 채워준다.
 */
export function buildHealthReportPreviewModel(params: {
  source: ReportSourceData;
  generated: HealthCheckupGeneratedContent;
  hospital: HospitalRow | null;
}): HealthReportPreviewModel {
  const { source, generated, hospital } = params;
  const t = resolveHospitalReportTemplate(hospital);
  const tokenOverrides = t.tokenOverrides ?? null;

  const hospitalNameKo =
    safeTrim(hospital?.name_ko) ||
    safeTrim(source.basicInfo?.hospitalName) ||
    '병원명';
  const hospitalNameEn = safeTrim(hospital?.name_en) || 'Animal Medical Center';
  const hospitalLogoSrc = t.logoSrc ?? undefined;
  const sealImageSrc = t.sealSrc ?? undefined;

  const ownerName = safeTrim(source.basicInfo?.ownerName);
  const patientName = safeTrim(source.basicInfo?.patientName);
  const speciesFromSource = safeTrim(source.basicInfo?.species);
  const breedFromSource = safeTrim(source.basicInfo?.breed);
  const sexFromSource = safeTrim(source.basicInfo?.sex);
  const speciesForLabel = safeTrim(generated.coverPatientSpecies) || speciesFromSource || breedFromSource;
  const speciesLabel = speciesLabelFromText(speciesForLabel);
  const petImageSrcFromHospital = safeTrim(hospital?.cover_pet_image_url);

  const coverProps: Record<string, unknown> = {
    hospitalNameKo,
    hospitalNameEn,
    hospitalLogoSrc: hospitalLogoSrc || undefined,
    hospitalLogoAlt: '',
    sealImageSrc: sealImageSrc || undefined,
    tokenOverrides: tokenOverrides ?? undefined,
    speciesLabel,
    petImageSrc: petImageSrcFromHospital || coverPetImageFromSpecies(speciesLabel),
    checkup: {
      date: safeTrim(generated.coverCheckupDate) || source.run.createdAt.slice(0, 10),
      program: safeTrim(generated.coverProgram),
      veterinarian: safeTrim(generated.coverVeterinarian),
    },
    pet: {
      name: nonEmptyOr(safeTrim(generated.coverPatientName), patientName) || undefined,
      species: nonEmptyOr(safeTrim(generated.coverPatientSpecies), speciesFromSource) || undefined,
      breed: nonEmptyOr(safeTrim(generated.coverPatientBreed), breedFromSource) || undefined,
      sex: nonEmptyOr(safeTrim(generated.coverPatientSex), sexFromSource) || undefined,
      age: safeTrim(generated.coverPatientAge) || safeTrim(source.basicInfo?.birth) || undefined,
      weight: safeTrim(generated.coverPatientWeight),
    },
    owner: {
      name: nonEmptyOr(safeTrim(generated.coverOwnerName), ownerName) || undefined,
    },
    footerPhone: safeTrim(hospital?.phone) || undefined,
    footerAddress: safeTrim(hospital?.address) || undefined,
    footerTaglineLine1: safeTrim(hospital?.tagline_line1) || undefined,
    footerTaglineLine2: safeTrim(hospital?.tagline_line2) || undefined,
  };

  const summaryProps: Record<string, unknown> = {
    hospitalNameKo,
    hospitalNameEn,
    hospitalLogoSrc: coverProps.hospitalLogoSrc,
    sealImageSrc: sealImageSrc || undefined,
    tokenOverrides: tokenOverrides ?? undefined,
    overallSummary: generated.overallSummary,
    followUpPlan: generated.followUpCare,
    timelineItems: timelineItemsFromGenerated(generated),
    directorTitleLine: formatDirectorHospitalLine(hospitalNameKo, hospital?.director_title),
    directorNameSpread: spreadKoreanCharsForFooter(hospital?.director_name_ko ?? '') || undefined,
    reportDateLine: formatKoreanDateLine(
      safeTrim(generated.coverCheckupDate) || source.run.createdAt.slice(0, 10),
    ),
  };

  const outerCoverProps: Record<string, unknown> = {
    hospitalNameKo,
    hospitalLogoSrc: coverProps.hospitalLogoSrc,
    hospitalLogoAlt: coverProps.hospitalLogoAlt,
    footerPhone: coverProps.footerPhone,
    footerAddress: coverProps.footerAddress,
    footerTaglineLine1: safeTrim(hospital?.tagline_line1) || undefined,
    footerTaglineLine2: safeTrim(hospital?.tagline_line2) || undefined,
    tokenOverrides: tokenOverrides ?? undefined,
  };

  const systemsPage3Blocks =
    parseHealthSystemsBlocksFromUnknown(generated.systemsPage3Blocks) ?? structuredClone(DEMO_HEALTH_SYSTEMS_BLOCKS);
  const systemsPage3bBlocks =
    parseHealthSystemsBlocksFromUnknown(generated.systemsPage3bBlocks) ??
    structuredClone(DEMO_HEALTH_SYSTEMS_PAGE_B_BLOCKS);
  const systemsPage4Blocks =
    parseHealthSystemsBlocksFromUnknown(generated.systemsPage4Blocks) ?? structuredClone(DEMO_HEALTH_DENTAL_SKIN_BLOCKS);
  const systemsPage5Blocks =
    parseHealthSystemsBlocksFromUnknown(generated.systemsPage5Blocks) ??
    structuredClone(DEMO_RADIOLOGY_ULTRASOUND_BLOCKS);

  return {
    hospital,
    coverProps,
    summaryProps,
    outerCoverProps,
    tokenOverrides: tokenOverrides ?? null,
    systemsPage3Blocks,
    systemsPage3bBlocks,
    systemsPage4Blocks,
    systemsPage5Blocks,
    labPages: buildLabPages(source, speciesForLabel),
    labInterpretation: safeTrim(generated.labInterpretation),
  };
}

