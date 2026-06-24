/**
 * 카테고리 분류는 @dashboard/lab-normalize 단일 소스에서 재export.
 * 이 파일에는 chart-api 전용 리포트 시트 고정/보조 프로파일만 남는다.
 */
import { canonicalizeLabItemName } from '@/lib/lab-item-normalize';
import {
  LAB_CATEGORIES,
  labItemCategory,
  detectSpeciesProfile,
  labCategorySortOrder,
  type LabCategory,
  type SpeciesProfile,
} from '@dashboard/lab-normalize';

export { LAB_CATEGORIES, labItemCategory, detectSpeciesProfile, labCategorySortOrder };
export type { LabCategory, SpeciesProfile };

const CBC_LAB_SHEET_FIXED: readonly string[] = [
  'RBC', 'HGB', 'HCT', 'MCV', 'MCH', 'MCHC', 'RDW',
  'WBC', 'NEU', 'NEU(%)', 'LYM', 'LYM(%)', 'MONO', 'MONO(%)', 'MON', 'MON(%)', 'GRA', 'GRA(%)', 'EOS', 'EOS(%)', 'BASO', 'BASO(%)',
  'PLT', 'MPV',
];
const CBC_LAB_SHEET_SUPPLEMENTARY: readonly string[] = [
  'MID', 'MID(%)', 'IMG', 'IMG(%)', 'RDW-SD', 'PDW', 'PCT', 'PLT-I', 'PLT-O', 'IPF', 'PLT-LCR', 'PLT-LCC', 'RETIC', 'RET-He', 'IRF', 'LFR', 'MFR', 'HFR', 'NRBC', 'Blood smear',
];

const CHEMISTRY_LAB_SHEET_FIXED: readonly string[] = [
  'ALT', 'AST', 'ALP', 'GGT', 'TBIL', 'TP', 'ALB', 'GLOB', 'ALB/GLOB',
  'BUN', 'CREA', 'BUN/CREA', 'SDMA', 'AMYL', 'LIPA', 'GLU', 'CHOL', 'TRIG', 'CK', 'Ca', 'PHOS',
];
const CHEMISTRY_LAB_SHEET_SUPPLEMENTARY_SHARED: readonly string[] = ['DBIL', 'TBA'];
const CHEMISTRY_LAB_SHEET_SUPPLEMENTARY_TAIL: readonly string[] = ['TLI', 'OSM CA', 'proBNP', 'cTnI'];

const ELECTROLYTE_LAB_SHEET_FIXED: readonly string[] = ['Na', 'K', 'Cl', 'NA/K'];
const ELECTROLYTE_LAB_SHEET_SUPPLEMENTARY: readonly string[] = ['iCa', 'Mg', 'AG'];

const BLOOD_GAS_LAB_SHEET_FIXED: readonly string[] = ['pH', 'pCO2', 'HCO3', 'BE', 'pO2'];
const BLOOD_GAS_LAB_SHEET_SUPPLEMENTARY: readonly string[] = ['SO2', 'Lactate', 'tCO2'];

const IMMUNOLOGIC_LAB_SHEET_FIXED: readonly string[] = ['B12', 'Folate'];
const IMMUNOLOGIC_LAB_SHEET_SUPPLEMENTARY: readonly string[] = ['ANA', 'Coombs', 'RF', 'IgG', 'IgM', 'IgA'];

const TUMOR_LAB_SHEET_FIXED: readonly string[] = [];
const TUMOR_LAB_SHEET_SUPPLEMENTARY: readonly string[] = [
  'TK', 'LDH', 'TK1', 'Histamine', 'Tryptase', 'PTHrP', 'AFP', 'CEA',
];

const COAGULATION_LAB_SHEET_FIXED: readonly string[] = ['PT', 'aPTT'];
const COAGULATION_LAB_SHEET_SUPPLEMENTARY: readonly string[] = [
  'D-dimer', 'FDP', 'AT III', 'BMBT', 'Platelet func',
];

const INFLAMMATORY_LAB_SHEET_FIXED: readonly string[] = ['CRP', 'Fibrinogen'];
const INFLAMMATORY_LAB_SHEET_SUPPLEMENTARY: readonly string[] = ['SAA', 'Ferritin'];

const HORMONE_LAB_SHEET_FIXED: readonly string[] = ['T4', 'fT4', 'TSH'];
const HORMONE_LAB_SHEET_SUPPLEMENTARY: readonly string[] = [
  'Cortisol', 'ACTH', 'LDDS', 'HDDS', 'INS', 'FRU', 'PROG', 'EST', 'TEST', 'PTH', 'ALD', 'RENIN', 'T3',
];

const INFECTIOUS_LAB_SHEET_FIXED_DOG: readonly string[] = ['HW Ag'];
const INFECTIOUS_LAB_SHEET_FIXED_CAT: readonly string[] = ['FeLV Ag', 'FIV Ab'];
const INFECTIOUS_LAB_SHEET_SUPPLEMENTARY_DOG: readonly string[] = [
  'CPV', 'Coronavirus', 'CDV', 'Ehrlichia', 'Anaplasma', 'Lyme', 'Babesia', 'Lepto', 'Toxo', 'PCR',
];
const INFECTIOUS_LAB_SHEET_SUPPLEMENTARY_CAT: readonly string[] = [
  'CPV', 'FPV', 'Coronavirus', 'FCoV Ab', 'FIP PCR', 'Ehrlichia', 'Anaplasma', 'Lyme', 'Babesia', 'Lepto', 'Toxo', 'PCR',
];

const DOG_PROFILE_ITEMS = [
  ...CBC_LAB_SHEET_FIXED,
  ...CBC_LAB_SHEET_SUPPLEMENTARY,
  ...CHEMISTRY_LAB_SHEET_FIXED,
  ...CHEMISTRY_LAB_SHEET_SUPPLEMENTARY_SHARED,
  ...CHEMISTRY_LAB_SHEET_SUPPLEMENTARY_TAIL,
  ...ELECTROLYTE_LAB_SHEET_FIXED,
  ...ELECTROLYTE_LAB_SHEET_SUPPLEMENTARY,
  ...COAGULATION_LAB_SHEET_FIXED,
  ...COAGULATION_LAB_SHEET_SUPPLEMENTARY,
  ...HORMONE_LAB_SHEET_FIXED,
  ...HORMONE_LAB_SHEET_SUPPLEMENTARY,
  ...INFLAMMATORY_LAB_SHEET_FIXED,
  ...INFLAMMATORY_LAB_SHEET_SUPPLEMENTARY,
  'cPL',
  ...INFECTIOUS_LAB_SHEET_FIXED_DOG,
  ...INFECTIOUS_LAB_SHEET_SUPPLEMENTARY_DOG,
  ...BLOOD_GAS_LAB_SHEET_FIXED,
  ...BLOOD_GAS_LAB_SHEET_SUPPLEMENTARY,
  ...IMMUNOLOGIC_LAB_SHEET_FIXED,
  ...IMMUNOLOGIC_LAB_SHEET_SUPPLEMENTARY,
  ...TUMOR_LAB_SHEET_SUPPLEMENTARY,
] as const;

const CAT_PROFILE_ITEMS = [
  ...CBC_LAB_SHEET_FIXED,
  ...CBC_LAB_SHEET_SUPPLEMENTARY,
  ...CHEMISTRY_LAB_SHEET_FIXED,
  ...CHEMISTRY_LAB_SHEET_SUPPLEMENTARY_SHARED,
  ...CHEMISTRY_LAB_SHEET_SUPPLEMENTARY_TAIL,
  ...ELECTROLYTE_LAB_SHEET_FIXED,
  ...ELECTROLYTE_LAB_SHEET_SUPPLEMENTARY,
  ...COAGULATION_LAB_SHEET_FIXED,
  ...COAGULATION_LAB_SHEET_SUPPLEMENTARY,
  ...HORMONE_LAB_SHEET_FIXED,
  ...HORMONE_LAB_SHEET_SUPPLEMENTARY,
  ...INFLAMMATORY_LAB_SHEET_FIXED,
  ...INFLAMMATORY_LAB_SHEET_SUPPLEMENTARY,
  'fPL',
  ...INFECTIOUS_LAB_SHEET_FIXED_CAT,
  ...INFECTIOUS_LAB_SHEET_SUPPLEMENTARY_CAT,
  ...BLOOD_GAS_LAB_SHEET_FIXED,
  ...BLOOD_GAS_LAB_SHEET_SUPPLEMENTARY,
  ...IMMUNOLOGIC_LAB_SHEET_FIXED,
  ...IMMUNOLOGIC_LAB_SHEET_SUPPLEMENTARY,
  ...TUMOR_LAB_SHEET_SUPPLEMENTARY,
] as const;

const DOG_LAB_SHEET_SUPPLEMENTARY_BY_CATEGORY: Readonly<Record<string, readonly string[]>> = {};
const CAT_LAB_SHEET_SUPPLEMENTARY_BY_CATEGORY: Readonly<Record<string, readonly string[]>> = {};

export function speciesProfileItems(species: SpeciesProfile): string[] {
  const list = species === 'cat' ? CAT_PROFILE_ITEMS : DOG_PROFILE_ITEMS;
  return [...list];
}

export type LabSheetCategoryProfile = {
  fixed: readonly string[];
  supplementary: readonly string[];
};

function buildLabSheetCategoryProfiles(
  flat: readonly string[],
  supplementaryByCategory: Readonly<Record<string, readonly string[]>>,
  species: SpeciesProfile,
): Readonly<Record<string, LabSheetCategoryProfile>> {
  const fixedByCat = new Map<string, string[]>();
  const seenMergeKeyByCat = new Map<string, Set<string>>();

  const canon = (n: string) => canonicalizeLabItemName(n, species) || n.trim();

  for (const name of flat) {
    const { key: catKey } = labItemCategory(name, species);
    if (catKey === 'other') continue;
    const mergeKey = canon(name).toUpperCase();
    let seen = seenMergeKeyByCat.get(catKey);
    if (!seen) {
      seen = new Set();
      seenMergeKeyByCat.set(catKey, seen);
    }
    if (seen.has(mergeKey)) continue;
    seen.add(mergeKey);
    const display = canon(name);
    const list = fixedByCat.get(catKey) ?? [];
    list.push(display);
    fixedByCat.set(catKey, list);
  }

  const out: Record<string, LabSheetCategoryProfile> = {};
  for (const c of LAB_CATEGORIES) {
    if (c.key === 'other') continue;
    const sup = supplementaryByCategory[c.key] ?? [];
    out[c.key] = {
      fixed: fixedByCat.get(c.key) ?? [],
      supplementary: [...sup],
    };
  }

  const cbcFixed = CBC_LAB_SHEET_FIXED.map((n) => canon(n));
  const cbcSup = [
    ...(supplementaryByCategory.cbc ?? []),
    ...CBC_LAB_SHEET_SUPPLEMENTARY.map((n) => canon(n)),
  ];
  out.cbc = { fixed: cbcFixed, supplementary: cbcSup };

  const chemFixed = CHEMISTRY_LAB_SHEET_FIXED.map((n) => canon(n));
  const plMarker = species === 'dog' ? 'cPL' : 'fPL';
  const chemSup = [
    ...(supplementaryByCategory.chemistry ?? []),
    ...CHEMISTRY_LAB_SHEET_SUPPLEMENTARY_SHARED.map((n) => canon(n)),
    ...CHEMISTRY_LAB_SHEET_SUPPLEMENTARY_TAIL.map((n) => canon(n)),
  ];
  out.chemistry = { fixed: chemFixed, supplementary: chemSup };

  const elyteFixed = ELECTROLYTE_LAB_SHEET_FIXED.map((n) => canon(n));
  const elyteSup = [
    ...(supplementaryByCategory.electrolyte ?? []),
    ...ELECTROLYTE_LAB_SHEET_SUPPLEMENTARY.map((n) => canon(n)),
  ];
  out.electrolyte = { fixed: elyteFixed, supplementary: elyteSup };

  const coagFixed = [...COAGULATION_LAB_SHEET_FIXED];
  const coagSup = [
    ...(supplementaryByCategory.coagulation ?? []),
    ...COAGULATION_LAB_SHEET_SUPPLEMENTARY.map((n) => canon(n)),
  ];
  out.coagulation = { fixed: coagFixed, supplementary: coagSup };

  const inflFixed = [...INFLAMMATORY_LAB_SHEET_FIXED];
  const inflSup = [
    ...(supplementaryByCategory.inflammatory ?? []),
    ...INFLAMMATORY_LAB_SHEET_SUPPLEMENTARY.map((n) => canon(n)),
    canon(plMarker),
  ];
  out.inflammatory = { fixed: inflFixed, supplementary: inflSup };

  const hormoneFixed = [...HORMONE_LAB_SHEET_FIXED];
  const hormoneSup = [
    ...(supplementaryByCategory.hormone ?? []),
    ...HORMONE_LAB_SHEET_SUPPLEMENTARY.map((n) => canon(n)),
  ];
  out.hormone = { fixed: hormoneFixed, supplementary: hormoneSup };

  const infFixed = species === 'dog' ? [...INFECTIOUS_LAB_SHEET_FIXED_DOG] : [...INFECTIOUS_LAB_SHEET_FIXED_CAT];
  const infSupTail =
    species === 'dog'
      ? INFECTIOUS_LAB_SHEET_SUPPLEMENTARY_DOG
      : INFECTIOUS_LAB_SHEET_SUPPLEMENTARY_CAT;
  const infSup = [
    ...(supplementaryByCategory.infectious ?? []),
    ...infSupTail.map((n) => canon(n)),
  ];
  out.infectious = { fixed: infFixed, supplementary: infSup };

  const bgFixed = [...BLOOD_GAS_LAB_SHEET_FIXED];
  const bgSup = [
    ...(supplementaryByCategory.blood_gas ?? []),
    ...BLOOD_GAS_LAB_SHEET_SUPPLEMENTARY.map((n) => canon(n)),
  ];
  out.blood_gas = { fixed: bgFixed, supplementary: bgSup };

  const immFixed = [...IMMUNOLOGIC_LAB_SHEET_FIXED];
  const immSup = [
    ...(supplementaryByCategory.immunologic ?? []),
    ...IMMUNOLOGIC_LAB_SHEET_SUPPLEMENTARY.map((n) => canon(n)),
  ];
  out.immunologic = { fixed: immFixed, supplementary: immSup };

  const tumorFixed = [...TUMOR_LAB_SHEET_FIXED];
  const tumorSup = [
    ...(supplementaryByCategory.tumor_marker ?? []),
    ...TUMOR_LAB_SHEET_SUPPLEMENTARY.map((n) => canon(n)),
  ];
  out.tumor_marker = { fixed: tumorFixed, supplementary: tumorSup };

  return out;
}

const DOG_LAB_SHEET_PROFILE = buildLabSheetCategoryProfiles(
  DOG_PROFILE_ITEMS,
  DOG_LAB_SHEET_SUPPLEMENTARY_BY_CATEGORY,
  'dog',
);
const CAT_LAB_SHEET_PROFILE = buildLabSheetCategoryProfiles(
  CAT_PROFILE_ITEMS,
  CAT_LAB_SHEET_SUPPLEMENTARY_BY_CATEGORY,
  'cat',
);

export function healthLabSheetProfiles(species: SpeciesProfile): Readonly<Record<string, LabSheetCategoryProfile>> {
  return species === 'cat' ? CAT_LAB_SHEET_PROFILE : DOG_LAB_SHEET_PROFILE;
}
