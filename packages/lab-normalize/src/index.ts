/**
 * 단일 소스 lab 항목 정규화 모듈.
 * chart-api / admin-web 양쪽이 이 패키지를 import 한다 (별칭 드리프트 방지).
 */

type CanonicalRule = {
  canonical: string;
  pattern: RegExp;
};

const PRIORITY_RULES: CanonicalRule[] = [
  { canonical: 'ALB/GLOB', pattern: /ALBUMIN\s*\/\s*GLOBULIN/i },
  { canonical: 'ALB/GLOB', pattern: /ALB\s*\/\s*GLOB(?:ULIN)?/i },
  { canonical: 'ALB/GLOB', pattern: /ALB\s*\/\s*GL\b/i },
  { canonical: 'ALB/GLOB', pattern: /(?:^|[^A-Z0-9%])A\s*\/\s*G(?:\b|\s*(?:R|ratio|비))/i },
  { canonical: 'BUN/CREA', pattern: /BUN\s*\/\s*CREA/i },
  { canonical: 'BUN/CREA', pattern: /BUN\s*\/\s*CR\b/i },
  { canonical: 'BUN/CREA', pattern: /(?:^|[^A-Z0-9])B\s*\/\s*C(?:\b|\s*(?:R|ratio|비))/i },
  { canonical: 'NA/K', pattern: /NA\s*\/\s*K/i },
  { canonical: 'D-dimer', pattern: /D[\s-]*DIMER/i },
];

const DIRECT_ALIASES: Record<string, string> = {
  RBCIDEXX: 'RBC',
  HCTIDEXX: 'HCT',
  HGBIDEXX: 'HGB',
  MCVIDEXX: 'MCV',
  MCHIDEXX: 'MCH',
  MCHCIDEXX: 'MCHC',
  RDWIDEXX: 'RDW',
  WBCIDEXX: 'WBC',
  NEUIDEXX: 'NEU',
  LYMIDEXX: 'LYM',
  MONOIDEXX: 'MONO',
  EOSIDEXX: 'EOS',
  BASOIDEXX: 'BASO',
  NEUPERCENTIDEXX: '%NEU',
  LYMPERCENTIDEXX: '%LYM',
  MONOPERCENTIDEXX: '%MONO',
  EOSPERCENTIDEXX: '%EOS',
  BASOPERCENTIDEXX: '%BASO',
  'NEU%': '%NEU',
  'LYM%': '%LYM',
  'MONO%': '%MONO',
  'EOS%': '%EOS',
  'BASO%': '%BASO',
  RETICPERCENTIDEXX: '%RETIC',
  ALBGLOB: 'ALB/GLOB',
  ALBGL: 'ALB/GLOB',
  BUNCREA: 'BUN/CREA',
  BUNCR: 'BUN/CREA',
  ALKP: 'ALP',
  NAK: 'NA/K',
  CI: 'CL',
  CAI: 'ICA',
  HEARTWORMAG: 'HW',
  FIBRINOGEN: 'FIB',
  DDIMER: 'D-dimer',
  TG: 'TRIG',
  APTT: 'aPTT',
  ATIII: 'AT III',
  PLATELETFUNC: 'Platelet func',
  OSMCA: 'OSM CA',
  CCRP: 'CRP',
  FSAA: 'SAA',
  혈액CRP: 'CRP',
  HEMOGLOBIN: 'HGB',
  HEMATOCRIT: 'HCT',
  PLATELETS: 'PLT',
  PLATLETS: 'PLT',
  LYMPHS: 'LYM',
  MONOS: 'MONO',
  AMY: 'AMYL',
  POTASSIUM: 'K',
  CHLORIDE: 'CL',
  BLOODSMEAR: 'Blood smear',
  CPL: 'cPL',
  FPL: 'fPL',
  ANIONGAP: 'AG',
  TT4: 'T4',
  BILTOTAL: 'TBIL',
  PDWCV: 'PDW',
  RDWCV: 'RDW',
  RDWSD: 'RDW-SD',
  RETHE: 'RET-He',
  PLTLCR: 'PLT-LCR',
  WBCBASO: 'BASO',
  'WBCBASO%': '%BASO',
  WBCEOS: 'EOS',
  'WBCEOS%': '%EOS',
  WBCLYM: 'LYM',
  'WBCLYM%': '%LYM',
  WBCMONO: 'MONO',
  'WBCMONO%': '%MONO',
  WBCNEU: 'NEU',
  'WBCNEU%': '%NEU',
  PROBNP: 'proBNP',
  NTPROBNP: 'proBNP',
  INS: 'INSULIN',
  PROG: 'PROGESTERONE',
  EST: 'E2',
  TEST: 'TESTOSTERONE',
  FELVAG: 'FELV',
  FIVAB: 'FIV',
  FCOVAB: 'FCoV Ab',
  FIPPCR: 'FIP PCR',
  TOXO: 'Toxo',
  CORONAVIRUS: 'Coronavirus',
  EHRLICHIA: 'EC/EE',
  ANAPLASMA: 'Anaplasma',
  BABESIA: 'Babesia',
  LYME: 'Lyme',
  LEPTO: 'Lepto',
  DISTEMPER: 'CDV',
  // Kit (SNAP 4Dx 등) 변형 → canonical: HW / Anaplasma / EC/EE / Lyme (옛 표기 AP_spp, EC-EE 도 잡음)
  HWAG: 'HW',
  HEARTWORM: 'HW',
  HEARTWORMANTIGEN: 'HW',
  HWANTIGEN: 'HW',
  HWT: 'HW',
  DIROFILARIA: 'HW',
  DIROFILARIAIMMITIS: 'HW',
  심장사상충: 'HW',
  심장사상충항원: 'HW',
  APSPP: 'Anaplasma',
  ANAPLASMASPP: 'Anaplasma',
  APHAGOCYTOPHILUM: 'Anaplasma',
  ANAPLASMAPHAGOCYTOPHILUM: 'Anaplasma',
  아나플라스마: 'Anaplasma',
  아나플라즈마: 'Anaplasma',
  ECEE: 'EC/EE',
  'EC/EE': 'EC/EE',
  ECANIS: 'EC/EE',
  EEWINGII: 'EC/EE',
  EHRLICHIACANIS: 'EC/EE',
  EHRLICHIAEWINGII: 'EC/EE',
  'EHRLICHIACANIS/EWINGII': 'EC/EE',
  에를리키아: 'EC/EE',
  에를리히아: 'EC/EE',
  LYMEDISEASE: 'Lyme',
  BORRELIA: 'Lyme',
  BORRELIABURGDORFERI: 'Lyme',
  BBURGDORFERI: 'Lyme',
  라임: 'Lyme',
  라임병: 'Lyme',
  PH: 'pH',
  PCO2: 'pCO2',
  PO2: 'pO2',
  TCO2: 'tCO2',
  LACTATE: 'Lactate',
  LAC: 'Lactate',
  COOMBS: 'Coombs',
  IGG: 'IgG',
  IGM: 'IgM',
  IGA: 'IgA',
  FOLATE: 'Folate',
  FOLICACID: 'Folate',
  VITAMINB12: 'B12',
  VITB12: 'B12',
  VB12: 'B12',
  COBALAMIN: 'B12',
  HISTAMINE: 'Histamine',
  TRYPTASE: 'Tryptase',
  PTHRP: 'PTHrP',
};

function normalizeToken(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/\(.*?\)/g, '')
    .replace(/[^\p{L}\p{N}/%]+/gu, '');
}

function pancreaticLipaseImmunoCanonical(
  normalized: string,
  species: LabCanonicalizeSpecies,
): string | null {
  if (
    normalized === 'PANCREATICLIPASE' ||
    normalized.startsWith('PANCREATICLIPASE') ||
    normalized === 'PLI' ||
    normalized === 'CPLI' ||
    normalized === 'FPLI' ||
    normalized === 'SPECPL' ||
    normalized === 'SPECCPL' ||
    normalized === 'SPECFPL'
  ) {
    return species === 'cat' ? 'fPL' : 'cPL';
  }
  return null;
}

/**
 * CBC 차등 항목: 같은 분석물질이 절대값/백분율 두 가지로 들어옴.
 * 절대값 → 'NEU', 백분율 → 'NEU(%)' 로 통일.
 * 원문 변형(NEU, NEU#, NEU %, WBC-NEU#, WBC-NEU%, %NEU, Neutrophils, ABS-NEU 등) 흡수.
 */
const CBC_DIFF_BASE: Record<string, string> = {
  NEU: 'NEU', NEUT: 'NEU', NEUTS: 'NEU', NEUTROPHIL: 'NEU', NEUTROPHILS: 'NEU',
  LYM: 'LYM', LYMS: 'LYM', LYMPH: 'LYM', LYMPHS: 'LYM', LYMPHO: 'LYM', LYMPHOCYTE: 'LYM', LYMPHOCYTES: 'LYM',
  MONO: 'MONO', MONOS: 'MONO', MONOCYTE: 'MONO', MONOCYTES: 'MONO',
  MON: 'MON',
  MID: 'MID', MXD: 'MID', MIXED: 'MID', // 중간세포(혼합세포) — WBC-MID%/WBC-MID# 등
  EOS: 'EOS', EOSIN: 'EOS', EOSINOPHIL: 'EOS', EOSINOPHILS: 'EOS',
  BASO: 'BASO', BASOS: 'BASO', BASOPHIL: 'BASO', BASOPHILS: 'BASO',
  RETIC: 'RETIC', RETICS: 'RETIC', RET: 'RETIC', RETICULOCYTE: 'RETIC', RETICULOCYTES: 'RETIC',
  GRA: 'GRA', GRAN: 'GRA', GRANS: 'GRA', GRANULOCYTE: 'GRA', GRANULOCYTES: 'GRA',
};

function cbcDifferentialCanonical(raw: string): string | null {
  const hasPercent = raw.includes('%');
  // 괄호내용·기호 제거 → 영숫자 stem. 그 후 WBC 접두 / ABS·COUNT 접두·접미 제거.
  const stem = raw
    .toUpperCase()
    .replace(/\(.*?\)/g, '')
    .replace(/[^A-Z0-9]/g, '')
    .replace(/^WBC/, '')
    .replace(/^ABS/, '')
    .replace(/(?:ABS|COUNT)$/, '');
  if (!stem) return null;
  const base = CBC_DIFF_BASE[stem];
  if (!base) return null;
  return hasPercent ? `${base}(%)` : base;
}

export type LabCanonicalizeSpecies = 'dog' | 'cat';

export function canonicalizeLabItemName(
  rawName: string,
  species?: LabCanonicalizeSpecies | null,
): string {
  const raw = rawName.trim();
  if (!raw) return '';

  for (const rule of PRIORITY_RULES) {
    if (rule.pattern.test(raw)) return rule.canonical;
  }

  const cbcDiff = cbcDifferentialCanonical(raw);
  if (cbcDiff) return cbcDiff;

  const normalized = normalizeToken(raw);
  const out = DIRECT_ALIASES[normalized] ?? normalized;

  if (species) {
    const pl = pancreaticLipaseImmunoCanonical(normalized, species);
    if (pl) return pl;
  }

  if (out === 'PL' && species) {
    return species === 'cat' ? 'fPL' : 'cPL';
  }

  return out;
}

/**
 * 인식 가능한 표준 검사 항목(정규화 성공 판정용).
 * canonicalizeLabItemName 결과가 이 집합에 없으면 "정규화 실패"로 간주
 * (= 리포트 표준 행에 못 들어가고 Other 로 분류됨).
 * chart-api/lib/lab-category-map.ts 의 표준 항목과 동기화 필요.
 */
const RECOGNIZED_LAB_ITEMS: ReadonlySet<string> = new Set(
  [
    // CBC
    'WBC', 'RBC', 'HGB', 'HCT', 'PLT', 'MCV', 'MCH', 'MCHC', 'RDW', 'RDW-CV', 'RDW-SD', 'PDW', 'PDW-CV', 'MPV',
    'NEU', 'LYM', 'MONO', 'MON', 'MID', 'GRA', 'EOS', 'BASO', 'RETIC', 'RET-He', 'IRF', 'LFR', 'MFR', 'HFR', 'PCT', 'PLT-LCR',
    '%NEU', '%LYM', '%MONO', '%EOS', '%BASO', '%RETIC', 'NRBC', 'BANDS', 'Blood smear',
    'NEU(%)', 'LYM(%)', 'MONO(%)', 'MON(%)', 'MID(%)', 'GRA(%)', 'EOS(%)', 'BASO(%)', 'RETIC(%)',
    // Chemistry
    'ALT', 'AST', 'ALP', 'GGT', 'ALB', 'TP', 'GLOB', 'ALB/GLOB', 'BUN', 'CREA', 'BUN/CREA', 'SDMA', 'GLU',
    'TBIL', 'DBIL', 'TBA', 'TCHO', 'CHOL', 'TRIG', 'AMYL', 'LIPA', 'CK', 'TLI', 'NH3', 'FRUC', 'OSM', 'OSM CA',
    'CKMB', 'proBNP', 'NT-proBNP', 'SDH', 'GLDH',
    // Electrolyte
    'NA', 'K', 'CL', 'CA', 'ICA', 'PHOS', 'MG', 'NA/K', 'AG',
    // Coagulation
    'PT', 'aPTT', 'TT', 'D-dimer', 'FDP', 'AT III', 'BMBT', 'Platelet func',
    // Hormone
    'T4', 'T3', 'fT4', 'TSH', 'Cortisol', 'ACTH', 'LDDS', 'HDDS', 'INSULIN', 'FRU', 'PROGESTERONE', 'E2',
    'TESTOSTERONE', 'AMH', 'IGF1', 'PTH', 'ALD', 'RENIN',
    // Inflammatory
    'CRP', 'SAA', 'HP', 'FIB', 'Ferritin', 'cPL', 'fPL', 'PL',
    // Infectious
    'FELV', 'FIV', 'FeLV Ag', 'FIV Ab', 'FPV', 'CPV', 'CDV', 'HWAG', 'HW Ag', 'Coronavirus', 'FCoV Ab',
    'FIP PCR', 'Ehrlichia', 'Anaplasma', 'Babesia', 'Lyme', 'Lepto', 'Toxo', 'PCR',
    // Blood gas
    'pH', 'pCO2', 'pO2', 'BE', 'HCO3', 'tCO2', 'SO2', 'Lactate',
    // Immunologic
    'B12', 'Folate', 'ANA', 'RF', 'Coombs', 'IgG', 'IgM', 'IgA',
    // Tumor marker
    'LDH', 'TK', 'TK1', 'Histamine', 'Tryptase', 'PTHrP', 'CEA', 'AFP', 'CA199', 'CA125', 'PSA',
    // Kit (SNAP 4Dx 등)
    'HW', 'Anaplasma', 'EC/EE', 'Lyme',
  ].map((s) => s.toUpperCase()),
);

/** 이미 정규화된 표준명이 인식 가능한 항목인지 여부. 실패 시 UI 에서 빨간색 표시용. */
export function isRecognizedLabItem(canonicalName: string): boolean {
  const name = (canonicalName ?? '').trim();
  if (!name) return false;
  return RECOGNIZED_LAB_ITEMS.has(name.toUpperCase());
}

// ===== 카테고리 분류 (단일 소스) =====

export type SpeciesProfile = 'dog' | 'cat';

export type LabCategory = {
  key: string;
  /** 풀 라벨 (영문 + 한글) */
  label: string;
  /** 짧은 영문 라벨 (UI 컬럼용) */
  shortLabel: string;
  order: number;
};

export const LAB_CATEGORIES: LabCategory[] = [
  { key: 'cbc', label: 'Complete Blood Count (전혈구 검사)', shortLabel: 'CBC', order: 0 },
  { key: 'chemistry', label: 'Chemistry (혈청화학 검사)', shortLabel: 'Chemistry', order: 1 },
  { key: 'electrolyte', label: 'Electrolyte (전해질 검사)', shortLabel: 'Electrolyte', order: 2 },
  { key: 'inflammatory', label: 'Inflammatory Marker (염증 지표 검사)', shortLabel: 'Inflammatory', order: 3 },
  { key: 'hormone', label: 'Hormone (호르몬 검사)', shortLabel: 'Hormone', order: 4 },
  { key: 'infectious', label: 'Infectious Disease (감염병 검사)', shortLabel: 'Infectious', order: 5 },
  { key: 'coagulation', label: 'Coagulation (혈액응고 검사)', shortLabel: 'Coagulation', order: 6 },
  { key: 'blood_gas', label: 'Blood Gas (혈액가스 검사)', shortLabel: 'Blood Gas', order: 7 },
  { key: 'immunologic', label: 'Immunologic Test (면역 및 특수 검사)', shortLabel: 'Immunologic', order: 8 },
  { key: 'tumor_marker', label: 'Tumor Marker (종양 검사)', shortLabel: 'Tumor Marker', order: 9 },
  { key: 'kit', label: 'Kit (키트 검사)', shortLabel: 'Kit', order: 10 },
  { key: 'other', label: 'Other (기타)', shortLabel: 'Other', order: 99 },
];

const CATEGORY_BY_KEY = new Map(LAB_CATEGORIES.map((c) => [c.key, c]));

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
  MON: 'cbc',
  MID: 'cbc',
  GRA: 'cbc',
  EOS: 'cbc',
  BASO: 'cbc',
  // CBC 차등 백분율 (canonical: X(%))
  'NEU(%)': 'cbc',
  'LYM(%)': 'cbc',
  'MONO(%)': 'cbc',
  'MON(%)': 'cbc',
  'MID(%)': 'cbc',
  'GRA(%)': 'cbc',
  'EOS(%)': 'cbc',
  'BASO(%)': 'cbc',
  'RETIC(%)': 'cbc',
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
  GIARDIAAG: 'infectious',
  TOXOPLASMA: 'infectious',
  Toxo: 'infectious',
  DISTEMPER: 'infectious',
  PARVO: 'infectious',
  CORONAVIRUS: 'infectious',
  Coronavirus: 'infectious',
  BABESIA: 'infectious',
  Babesia: 'infectious',
  LEPTO: 'infectious',
  Lepto: 'infectious',
  LEISHMANIA: 'infectious',
  PCR: 'infectious',
  'FCoV Ab': 'infectious',
  'FIP PCR': 'infectious',

  // Kit (SNAP 4Dx 등) — canonical 항목
  HW: 'kit',
  'HW Ag': 'kit',
  HWAG: 'kit',
  HEARTWORMAG: 'kit',
  Anaplasma: 'kit',
  ANAPLASMA: 'kit',
  'EC/EE': 'kit',
  EHRLICHIA: 'kit',
  Ehrlichia: 'kit',
  Lyme: 'kit',
  LYME: 'kit',

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

export function detectSpeciesProfile(raw: string | null | undefined): SpeciesProfile {
  const t = (raw ?? '').toLowerCase();
  if (t.includes('cat') || t.includes('feline') || t.includes('고양') || t.includes('묘')) return 'cat';
  return 'dog';
}

export function labItemCategory(itemName: string, species?: SpeciesProfile): LabCategory {
  const canonical = canonicalizeLabItemName(itemName, species);
  const key = ITEM_TO_CATEGORY[canonical] ?? ITEM_TO_CATEGORY[itemName.trim()];
  if (key) return CATEGORY_BY_KEY.get(key)!;
  return CATEGORY_BY_KEY.get('other')!;
}

export function labCategorySortOrder(categoryKey: string): number {
  return CATEGORY_BY_KEY.get(categoryKey)?.order ?? 99;
}

// ===== 플래그 보정 (부등호 값) =====

export type LabFlag = 'low' | 'high' | 'normal' | 'unknown';

function parseRefRange(ref: string | null | undefined): { low: number | null; high: number | null } {
  if (!ref) return { low: null, high: null };
  const m = ref.replace(/,/g, '').match(/(-?\d+(?:\.\d+)?)\s*[-~–—]\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return { low: null, high: null };
  const low = Number.parseFloat(m[1]);
  const high = Number.parseFloat(m[2]);
  return {
    low: Number.isFinite(low) ? low : null,
    high: Number.isFinite(high) ? high : null,
  };
}

/** 부등호 값 해석: ">N"/"N<" → 값이 N 초과(gt), "<N"/"N>" → 값이 N 미만(lt). */
function parseInequalityValue(valueText: string): { gt?: number; lt?: number } | null {
  const t = (valueText ?? '').replace(/,/g, '').trim();
  if (!t) return null;
  let m: RegExpMatchArray | null;
  // 초과: >N, ≥N, N<, N≤
  if ((m = t.match(/^[>≥]\s*=?\s*(\d+(?:\.\d+)?)/))) return { gt: Number.parseFloat(m[1]) };
  if ((m = t.match(/(\d+(?:\.\d+)?)\s*[<≤]\s*$/))) return { gt: Number.parseFloat(m[1]) };
  // 미만: <N, ≤N, N>, N≥
  if ((m = t.match(/^[<≤]\s*=?\s*(\d+(?:\.\d+)?)/))) return { lt: Number.parseFloat(m[1]) };
  if ((m = t.match(/(\d+(?:\.\d+)?)\s*[>≥]\s*$/))) return { lt: Number.parseFloat(m[1]) };
  return null;
}

/**
 * 부등호 값(>N, <N, N>, N<)을 참고범위와 비교해 플래그를 보정한다.
 * - 기존 플래그가 unknown 일 때만 동작 (차트 자체 H/L 마커가 있으면 그대로 둔다).
 * - 혈액검사 값은 음수가 없다고 가정한다.
 *   · 값 > N 이고 N ≥ 상한 → high
 *   · 값 < N 이고 N ≤ 하한 → low
 *   · 값 < N 이고 하한 ≤ 0 이고 N ≤ 상한 → normal ([0,N) ⊆ 범위)
 *   · 그 외(판정 불가) → 그대로 unknown
 */
export function refineLabFlag(
  currentFlag: LabFlag,
  valueText: string,
  referenceRange: string | null | undefined,
): LabFlag {
  if (currentFlag !== 'unknown') return currentFlag;
  const ineq = parseInequalityValue(valueText);
  if (!ineq) return currentFlag;
  const { low, high } = parseRefRange(referenceRange);

  if (ineq.gt !== undefined) {
    if (high !== null && ineq.gt >= high) return 'high';
    return 'unknown';
  }
  if (ineq.lt !== undefined) {
    if (low !== null && ineq.lt <= low) return 'low';
    if (high !== null && ineq.lt <= high && (low === null || low <= 0)) return 'normal';
    return 'unknown';
  }
  return currentFlag;
}
