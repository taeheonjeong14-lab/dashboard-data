import { canonicalizeLabItemName } from '@/lib/lab-item-normalize';

export type LabCategory = {
  key: string;
  label: string;
  order: number;
};

const CATEGORIES: LabCategory[] = [
  { key: 'cbc', label: 'Complete Blood Count (전혈구 검사)', order: 0 },
  { key: 'chemistry', label: 'Chemistry (혈청화학 검사)', order: 1 },
  { key: 'electrolyte', label: 'Electrolyte (전해질 검사)', order: 2 },
  { key: 'inflammatory', label: 'Inflammatory Marker (염증 지표 검사)', order: 3 },
  { key: 'hormone', label: 'Hormone (호르몬 검사)', order: 4 },
  { key: 'infectious', label: 'Infectious Disease (감염병 검사)', order: 5 },
  { key: 'coagulation', label: 'Coagulation (혈액응고 검사)', order: 6 },
  { key: 'blood_gas', label: 'Blood Gas (혈액가스 검사)', order: 7 },
  { key: 'immunologic', label: 'Immunologic Test (면역 및 특수 검사)', order: 8 },
  { key: 'tumor_marker', label: 'Tumor Marker (종양 검사)', order: 9 },
  { key: 'other', label: 'Other (기타)', order: 99 },
];

const CATEGORY_BY_KEY = new Map(CATEGORIES.map((c) => [c.key, c]));

const ITEM_TO_CATEGORY: Record<string, string> = {
  // CBC
  WBC: 'cbc',
  RBC: 'cbc',
  HGB: 'cbc',
  HCT: 'cbc',
  PLT: 'cbc',
  MCV: 'cbc',
  MCH: 'cbc',
  MCHC: 'cbc',
  RDW: 'cbc',
  'RDW-CV': 'cbc',
  RDWCV: 'cbc',
  'RDW-SD': 'cbc',
  PDW: 'cbc',
  'PDW-CV': 'cbc',
  PDWCV: 'cbc',
  MPV: 'cbc',
  NEU: 'cbc',
  LYM: 'cbc',
  MONO: 'cbc',
  EOS: 'cbc',
  BASO: 'cbc',
  RETIC: 'cbc',
  'RET-He': 'cbc',
  IRF: 'cbc',
  LFR: 'cbc',
  MFR: 'cbc',
  HFR: 'cbc',
  PCT: 'cbc',
  'PLT-LCR': 'cbc',
  'NEU%': 'cbc',
  'LYM%': 'cbc',
  'MONO%': 'cbc',
  'EOS%': 'cbc',
  'BASO%': 'cbc',
  'WBC-NEU#': 'cbc',
  'WBC-NEU%': 'cbc',
  'WBC-LYM#': 'cbc',
  'WBC-LYM%': 'cbc',
  'WBC-MONO#': 'cbc',
  'WBC-MONO%': 'cbc',
  'WBC-EOS#': 'cbc',
  'WBC-EOS%': 'cbc',
  'WBC-BASO#': 'cbc',
  'WBC-BASO%': 'cbc',
  WBCNEU: 'cbc',
  'WBCNEU%': 'cbc',
  WBCLYM: 'cbc',
  'WBCLYM%': 'cbc',
  WBCMONO: 'cbc',
  'WBCMONO%': 'cbc',
  WBCEOS: 'cbc',
  'WBCEOS%': 'cbc',
  WBCBASO: 'cbc',
  'WBCBASO%': 'cbc',
  '%NEU': 'cbc',
  '%LYM': 'cbc',
  '%MONO': 'cbc',
  '%EOS': 'cbc',
  '%BASO': 'cbc',
  '%RETIC': 'cbc',
  RETICPERCENT: 'cbc',
  NRBC: 'cbc',
  BANDS: 'cbc',
  PLCR: 'cbc',
  PDL: 'cbc',
  ABSNEU: 'cbc',
  ABSLYM: 'cbc',
  ABSMONO: 'cbc',
  ABSEOS: 'cbc',
  ABSBASO: 'cbc',
  BLOODSMEAR: 'cbc',
  'Blood smear': 'cbc',
  백혈구: 'cbc',
  적혈구: 'cbc',
  혈소판: 'cbc',
  헤모글로빈: 'cbc',
  헤마토크릿: 'cbc',

  // Chemistry
  ALT: 'chemistry',
  AST: 'chemistry',
  ALP: 'chemistry',
  ALKP: 'chemistry',
  GGT: 'chemistry',
  ALB: 'chemistry',
  TP: 'chemistry',
  GLOB: 'chemistry',
  'ALB/GLOB': 'chemistry',
  'ALB/GL': 'chemistry',
  'A/G': 'chemistry',
  BUN: 'chemistry',
  CREA: 'chemistry',
  'BUN/CREA': 'chemistry',
  'BUN/CR': 'chemistry',
  'B/C': 'chemistry',
  SDMA: 'chemistry',
  GLU: 'chemistry',
  TBIL: 'chemistry',
  BILTOTAL: 'chemistry',
  TCHO: 'chemistry',
  CHOL: 'chemistry',
  TG: 'chemistry',
  TRIG: 'chemistry',
  AMYL: 'chemistry',
  LIPA: 'chemistry',
  CK: 'chemistry',
  DBIL: 'chemistry',
  TBA: 'chemistry',
  TLI: 'chemistry',
  CPL: 'inflammatory',
  FPL: 'inflammatory',
  cPL: 'inflammatory',
  fPL: 'inflammatory',
  PL: 'inflammatory',
  NH3: 'chemistry',
  FRUC: 'chemistry',
  FRUCTOSAMINE: 'chemistry',
  LAC: 'blood_gas',
  LACTATE: 'blood_gas',
  Lactate: 'blood_gas',
  OSM: 'chemistry',
  'OSM CA': 'chemistry',
  OSMCA: 'chemistry',
  OSMOLALITY: 'chemistry',
  CKMB: 'chemistry',
  proBNP: 'chemistry',
  PROBNP: 'chemistry',
  'NT-proBNP': 'chemistry',
  NTPROBNP: 'chemistry',
  SDH: 'chemistry',
  GLDH: 'chemistry',
  AMMONIA: 'chemistry',
  총단백: 'chemistry',
  알부민: 'chemistry',
  글로불린: 'chemistry',
  포도당: 'chemistry',
  크레아티닌: 'chemistry',
  요소질소: 'chemistry',
  콜레스테롤: 'chemistry',
  중성지방: 'chemistry',
  아밀레이스: 'chemistry',
  리파아제: 'chemistry',

  // Electrolytes
  NA: 'electrolyte',
  K: 'electrolyte',
  CL: 'electrolyte',
  CA: 'electrolyte',
  ICA: 'electrolyte',
  PHOS: 'electrolyte',
  P: 'electrolyte',
  MG: 'electrolyte',
  'NA/K': 'electrolyte',
  'Na/K': 'electrolyte',
  NAK: 'electrolyte',
  CI: 'electrolyte',
  CAI: 'electrolyte',
  AG: 'electrolyte',
  iCa: 'electrolyte',
  칼슘: 'electrolyte',
  인: 'electrolyte',
  나트륨: 'electrolyte',
  칼륨: 'electrolyte',
  염소: 'electrolyte',
  마그네슘: 'electrolyte',

  // Coagulation
  PT: 'coagulation',
  APTT: 'coagulation',
  aPTT: 'coagulation',
  TT: 'coagulation',
  DDIMER: 'coagulation',
  'D-DIMER': 'coagulation',
  'D-dimer': 'coagulation',
  FDP: 'coagulation',
  ATIII: 'coagulation',
  'AT III': 'coagulation',
  BMBT: 'coagulation',
  PLATELETFUNC: 'coagulation',
  'Platelet func': 'coagulation',

  // Hormone
  T4: 'hormone',
  TT4: 'hormone',
  T3: 'hormone',
  FT4: 'hormone',
  fT4: 'hormone',
  TSH: 'hormone',
  CORTISOL: 'hormone',
  Cortisol: 'hormone',
  ACTH: 'hormone',
  LDDS: 'hormone',
  HDDS: 'hormone',
  INS: 'hormone',
  INSULIN: 'hormone',
  FRU: 'hormone',
  PROG: 'hormone',
  PROGESTERONE: 'hormone',
  EST: 'hormone',
  TEST: 'hormone',
  AMH: 'hormone',
  IGF1: 'hormone',
  PTH: 'hormone',
  TESTOSTERONE: 'hormone',
  E2: 'hormone',
  ALD: 'hormone',
  RENIN: 'hormone',

  // Inflammatory
  CRP: 'inflammatory',
  SAA: 'inflammatory',
  HP: 'inflammatory',
  FIB: 'inflammatory',
  FIBRINOGEN: 'inflammatory',
  FERRITIN: 'inflammatory',
  Ferritin: 'inflammatory',

  // Infectious disease
  FELV: 'infectious',
  FIV: 'infectious',
  'FeLV Ag': 'infectious',
  'FIV Ab': 'infectious',
  FPV: 'infectious',
  CPV: 'infectious',
  CDV: 'infectious',
  HWAG: 'infectious',
  'HW Ag': 'infectious',
  HEARTWORMAG: 'infectious',
  GIARDIAAG: 'infectious',
  TOXOPLASMA: 'infectious',
  Toxo: 'infectious',
  DISTEMPER: 'infectious',
  PARVO: 'infectious',
  CORONAVIRUS: 'infectious',
  Coronavirus: 'infectious',
  ANAPLASMA: 'infectious',
  EHRLICHIA: 'infectious',
  Ehrlichia: 'infectious',
  Anaplasma: 'infectious',
  BABESIA: 'infectious',
  Babesia: 'infectious',
  LYME: 'infectious',
  Lyme: 'infectious',
  LEPTO: 'infectious',
  Lepto: 'infectious',
  LEISHMANIA: 'infectious',
  PCR: 'infectious',
  'FCoV Ab': 'infectious',
  'FIP PCR': 'infectious',

  // Blood gas
  PH: 'blood_gas',
  pH: 'blood_gas',
  PCO2: 'blood_gas',
  pCO2: 'blood_gas',
  PO2: 'blood_gas',
  pO2: 'blood_gas',
  BE: 'blood_gas',
  HCO3: 'blood_gas',
  TCO2: 'blood_gas',
  tCO2: 'blood_gas',
  SO2: 'blood_gas',

  // Immunologic test
  B12: 'immunologic',
  VB12: 'immunologic',
  VITB12: 'immunologic',
  VITAMINB12: 'immunologic',
  COBALAMIN: 'immunologic',
  FOLATE: 'immunologic',
  FOLICACID: 'immunologic',
  Folate: 'immunologic',
  ANA: 'immunologic',
  RF: 'immunologic',
  COOMBS: 'immunologic',
  Coombs: 'immunologic',
  IGG: 'immunologic',
  IGM: 'immunologic',
  IGA: 'immunologic',
  IgG: 'immunologic',
  IgM: 'immunologic',
  IgA: 'immunologic',

  // Tumor marker
  LDH: 'tumor_marker',
  TK: 'tumor_marker',
  TK1: 'tumor_marker',
  HISTAMINE: 'tumor_marker',
  Histamine: 'tumor_marker',
  TRYPTASE: 'tumor_marker',
  Tryptase: 'tumor_marker',
  PTHRP: 'tumor_marker',
  PTHrP: 'tumor_marker',
  CEA: 'tumor_marker',
  AFP: 'tumor_marker',
  CA199: 'tumor_marker',
  CA125: 'tumor_marker',
  PSA: 'tumor_marker',
};

export type SpeciesProfile = 'dog' | 'cat';

const CBC_LAB_SHEET_FIXED: readonly string[] = [
  'RBC', 'HGB', 'HCT', 'MCV', 'MCH', 'MCHC', 'RDW',
  'WBC', 'NEU', '%NEU', 'LYM', '%LYM', 'MONO', '%MONO', 'EOS', '%EOS', 'BASO', '%BASO',
  'PLT', 'MPV',
];
const CBC_LAB_SHEET_SUPPLEMENTARY: readonly string[] = [
  'RDW-SD', 'PDW', 'PCT', 'PLT-LCR', 'RETIC', 'RET-He', 'IRF', 'LFR', 'MFR', 'HFR', 'NRBC', 'Blood smear',
];

const CHEMISTRY_LAB_SHEET_FIXED: readonly string[] = [
  'ALT', 'AST', 'ALP', 'GGT', 'TBIL', 'TP', 'ALB', 'GLOB', 'ALB/GLOB',
  'BUN', 'CREA', 'BUN/CREA', 'SDMA', 'AMYL', 'LIPA', 'GLU', 'CHOL', 'TRIG', 'CK', 'Ca', 'PHOS',
];
const CHEMISTRY_LAB_SHEET_SUPPLEMENTARY_SHARED: readonly string[] = ['DBIL', 'TBA'];
const CHEMISTRY_LAB_SHEET_SUPPLEMENTARY_TAIL: readonly string[] = ['TLI', 'OSM CA', 'proBNP'];

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

export function detectSpeciesProfile(raw: string | null | undefined): SpeciesProfile {
  const t = (raw ?? '').toLowerCase();
  if (t.includes('cat') || t.includes('feline') || t.includes('고양') || t.includes('묘')) return 'cat';
  return 'dog';
}

export function speciesProfileItems(species: SpeciesProfile): string[] {
  const list = species === 'cat' ? CAT_PROFILE_ITEMS : DOG_PROFILE_ITEMS;
  return [...list];
}

export function labItemCategory(itemName: string, species?: SpeciesProfile): LabCategory {
  const canonical = canonicalizeLabItemName(itemName, species);
  const key = ITEM_TO_CATEGORY[canonical] ?? ITEM_TO_CATEGORY[itemName.trim()];
  if (key) return CATEGORY_BY_KEY.get(key)!;
  return CATEGORY_BY_KEY.get('other')!;
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
  for (const c of CATEGORIES) {
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

export function labCategorySortOrder(categoryKey: string): number {
  return CATEGORY_BY_KEY.get(categoryKey)?.order ?? 99;
}

export { CATEGORIES as LAB_CATEGORIES };
