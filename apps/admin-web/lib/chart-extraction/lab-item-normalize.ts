type CanonicalRule = {
  canonical: string;
  pattern: RegExp;
};

const PRIORITY_RULES: CanonicalRule[] = [
  { canonical: '%RETIC', pattern: /(?:^|[^A-Z])%+\s*RETIC(?:[^A-Z]|$)/i },
  { canonical: 'RETIC', pattern: /(?:^|[^A-Z])RETIC(?:[^A-Z]|$)/i },
  { canonical: 'ALB/GLOB', pattern: /ALBUMIN\s*\/\s*GLOBULIN/i },
  { canonical: 'ALB/GLOB', pattern: /ALB\s*\/\s*GLOB(?:ULIN)?/i },
  { canonical: 'BUN/CREA', pattern: /BUN\s*\/\s*CREA/i },
  { canonical: 'NA/K', pattern: /NA\s*\/\s*K/i },
  { canonical: 'D-dimer', pattern: /D[\s-]*DIMER/i },
];

const DIRECT_ALIASES: Record<string, string> = {
  ALKP: 'ALP',
  CI: 'CL',
  CAI: 'ICA',
  TG: 'TRIG',
  APTT: 'aPTT',
  CCRP: 'CRP',
  FSAA: 'SAA',
  HEMOGLOBIN: 'HGB',
  HEMATOCRIT: 'HCT',
  PLATELETS: 'PLT',
  PLATLETS: 'PLT',
  LYMPHS: 'LYM',
  MONOS: 'MONO',
  AMY: 'AMYL',
  POTASSIUM: 'K',
  CHLORIDE: 'CL',
  CPL: 'cPL',
  FPL: 'fPL',
  ANIONGAP: 'AG',
  TT4: 'T4',
  BILTOTAL: 'TBIL',
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
    normalized === 'FPLI'
  ) {
    return species === 'cat' ? 'fPL' : 'cPL';
  }
  return null;
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

  const normalized = normalizeToken(raw);
  const out = DIRECT_ALIASES[normalized] ?? normalized;

  if (species) {
    const pl = pancreaticLipaseImmunoCanonical(normalized, species);
    if (pl) return pl;
  }
  if (out === 'PL' && species) return species === 'cat' ? 'fPL' : 'cPL';
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
    'NEU', 'LYM', 'MONO', 'EOS', 'BASO', 'RETIC', 'RET-He', 'IRF', 'LFR', 'MFR', 'HFR', 'PCT', 'PLT-LCR',
    '%NEU', '%LYM', '%MONO', '%EOS', '%BASO', '%RETIC', 'NRBC', 'BANDS', 'Blood smear',
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
  ].map((s) => s.toUpperCase()),
);

/** 이미 정규화된 표준명이 인식 가능한 항목인지 여부. 실패 시 UI 에서 빨간색 표시용. */
export function isRecognizedLabItem(canonicalName: string): boolean {
  const name = (canonicalName ?? '').trim();
  if (!name) return false;
  return RECOGNIZED_LAB_ITEMS.has(name.toUpperCase());
}

