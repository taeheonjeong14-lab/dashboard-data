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
  { canonical: 'ALB/GLOB', pattern: /ALB\s*\/\s*GLB\b/i },
  { canonical: 'ALB/GLOB', pattern: /ALB\s*\/\s*GL\b/i },
  { canonical: 'ALB/GLOB', pattern: /(?:^|[^A-Z0-9%])A\s*\/\s*G(?:\b|\s*(?:R|ratio|비))/i },
  { canonical: 'BUN/CREA', pattern: /BUN\s*\/\s*CREA/i },
  { canonical: 'BUN/CREA', pattern: /BUN\s*\/\s*CRE\b/i },
  { canonical: 'BUN/CREA', pattern: /BUN\s*\/\s*CR\b/i },
  { canonical: 'BUN/CREA', pattern: /(?:^|[^A-Z0-9])B\s*\/\s*C(?:\b|\s*(?:R|ratio|비))/i },
  { canonical: 'NA/K', pattern: /NA\s*\/\s*K/i },
  { canonical: 'D-dimer', pattern: /D[\s-]*DIMER/i },
  // 이온화 칼슘(Ca2+) = iCA. "(7.4)"는 pH 7.4 보정값이라 별개 항목(iCA(7.4)) → normalizeToken 이 괄호를
  //  지우기 전에 여기서 구분해 잡는다. (7.4) 형태를 먼저 검사. 총칼슘 "Ca"(+ 없음)는 여기서 안 잡히고 CA 로.
  { canonical: 'iCA(7.4)', pattern: /\bi?ca\s*2?\s*\+{1,2}\s*\(\s*7\.?4\s*\)/i },
  { canonical: 'iCA(7.4)', pattern: /\bica\s*\(\s*7\.?4\s*\)/i },
  { canonical: 'iCA', pattern: /\bi?ca\s*2?\s*\+{1,2}/i },
  // ACTH 자극검사 — 자극 전/후 코르티솔은 서로 다른 값이라 Pre-ACTH / Post-ACTH 로 구분한다.
  //  하이픈·스페이스·붙임·괄호형(예: "Post-ACTH", "Post ACTH", "Cortisol (Post)", "1hr Post ACTH") 모두 흡수.
  //  접두어 없는 단독 'ACTH'·'Cortisol' 은 여기서 안 잡히고 각자 이름으로 유지된다.
  //  (normalizeToken 이 괄호를 지우기 전에 raw 에서 먼저 매칭되어야 하므로 PRIORITY_RULES 에 둔다)
  { canonical: 'Post-ACTH', pattern: /POST[\s-]*ACTH/i },
  { canonical: 'Post-ACTH', pattern: /CORTISOL\s*\(?\s*POST\b/i },
  { canonical: 'Pre-ACTH', pattern: /PRE[\s-]*ACTH/i },
  { canonical: 'Pre-ACTH', pattern: /CORTISOL\s*\(?\s*PRE\b/i },
  { canonical: 'Pre-ACTH', pattern: /BASE\s*LINE\s*CORTISOL/i },
  { canonical: 'Pre-ACTH', pattern: /BASAL\s*CORTISOL/i },
  // NT-proBNP(심장 바이오마커) — 종 접두(f.=feline / c.=canine)·하이픈·스페이스 변형을 모두 proBNP 로.
  //  normalizeToken 이 "f.NT-proBNP" → "FNTPROBNP" 로 만들어 별칭 매칭이 안 되므로 raw 단계에서 잡는다.
  { canonical: 'proBNP', pattern: /\bNT[\s.-]*pro[\s-]*BNP\b/i },
  { canonical: 'proBNP', pattern: /\bpro[\s-]*BNP\b/i },
  // 표준중탄산염(standard bicarbonate)은 실제 중탄산염(HCO3)과 다른 항목(호흡 성분 보정) →
  //  normalizeToken 이 "(std)" 괄호를 지우기 전에 raw 에서 먼저 구분해 HCO3(std) 로 잡는다.
  //  OCR 이 O 를 0 으로 읽는 경우(HC03)도 함께 흡수. 단독 HCO3 는 여기서 안 잡히고 아래 별칭으로.
  { canonical: 'HCO3(std)', pattern: /HC[O0]3.*\bs?td\b/i },
  { canonical: 'HCO3(std)', pattern: /HC[O0]3.*standard/i },
  { canonical: 'HCO3(std)', pattern: /\b(?:s?td|standard)\b.*HC[O0]3/i },
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
  CAI: 'iCA',
  ICA: 'iCA', // 차트가 그대로 "iCa/ICA" 로 쓴 경우 표시는 iCA 로 통일
  THB: 'tHb', // total Hb (혈액가스 co-oximetry) — CBC 의 HGB 와 별개 항목
  CTHB: 'tHb',
  TOTALHB: 'tHb',
  TOTALHEMOGLOBIN: 'tHb',
  HEARTWORMAG: 'HW',
  FIBRINOGEN: 'FIB',
  DDIMER: 'D-dimer',
  TG: 'TRIG',
  APTT: 'aPTT',
  ATIII: 'AT III',
  PLATELETFUNC: 'Platelet func',
  OSMCA: 'OSM CA',
  OSMOLALITY: 'OSM',
  OSMOLARITY: 'OSM',
  OSMOLALITYCALC: 'OSM CA', // 계산 삼투압(calculated osmolality)
  CCRP: 'CRP',
  CANINECRP: 'CRP', // Canine CRP (개 CRP) → CRP
  FSAA: 'SAA',
  혈액CRP: 'CRP',
  HEMOGLOBIN: 'HGB',
  HB: 'HGB', // Hb(Hemoglobin) → 괄호 제거 후 "HB"
  HEMATOCRIT: 'HCT',
  // 옛 효소 명칭 (GPT=ALT, GOT=AST)
  ALTGPT: 'ALT',
  GPT: 'ALT',
  ASTGOT: 'AST',
  GOT: 'AST',
  // 총단백 / 총콜레스테롤 표기 변형
  TPRO: 'TP',
  TPROT: 'TP',
  TPROTEIN: 'TP',
  TOTALPROTEIN: 'TP',
  TCHOL: 'CHOL',
  TCHOLESTEROL: 'CHOL',
  TOTALCHOLESTEROL: 'CHOL',
  PLATELETS: 'PLT',
  PLATLETS: 'PLT',
  // PLT-I(임피던스)·PLT-O(광학)는 같은 혈소판수의 다른 측정법 — 값이 다를 수 있어 PLT로 합치지 않고 별개로 둔다.
  PLTI: 'PLT-I',
  PLTO: 'PLT-O',

  LYMPHS: 'LYM',
  MONOS: 'MONO',
  AMY: 'AMYL',
  POTASSIUM: 'K',
  CHLORIDE: 'CL',
  BLOODSMEAR: 'Blood smear',
  CPL: 'cPL',
  FPL: 'fPL',
  QPL: 'PL', // species 미상일 때의 폴백(아는 경우 pancreaticLipaseImmunoCanonical 가 cPL/fPL 로)
  ANIONGAP: 'AG',
  // 요산(Uric acid) — 혈액 화학 항목. 사람 검사식 약어 'UA' 는 우리 시스템에서 요검사(Urinalysis)
  // 섹션을 뜻해 충돌하므로 canonical 은 'URIC'. 소변 요산은 UA 섹션 매핑에서 'U-URIC' 으로 간다.
  URIC: 'URIC', URICACID: 'URIC', URICA: 'URIC', 요산: 'URIC',
  TT4: 'T4',
  BILTOTAL: 'TBIL',
  PDWCV: 'PDW',
  RDWCV: 'RDW',
  RDWSD: 'RDW-SD',
  RETHE: 'RET-He',
  RHE: 'RET-He', // Sysmex 계열 약어(망상적혈구 혈색소량, 단위 pg) → 표준 RET-He
  PLTLCR: 'PLT-LCR',
  PLCR: 'PLT-LCR', // P-LCR / P_LCR = Platelet Large Cell Ratio(비율) → 표준 PLT-LCR
  PLCC: 'PLT-LCC', // P-LCC / P_LCC = Platelet Large Cell Count(절대값) → 표준 PLT-LCC
  PLTLCC: 'PLT-LCC',
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
  FNTPROBNP: 'proBNP', CNTPROBNP: 'proBNP', FPROBNP: 'proBNP', CPROBNP: 'proBNP',
  // Urinalysis(요검사) — 소변 고유 항목만. 혈액과 이름이 겹치는 GLU/PRO/BIL/pH/Ketone/Blood 은 넣지 않는다
  //  (이름만으론 소변/혈액 구분 불가 → 오분류 방지). 겹치는 항목은 추후 섹션 인식으로 별도 대응.
  SG: 'SG', USG: 'SG', SPGR: 'SG', SPECIFICGRAVITY: 'SG',
  UBG: 'UBG', URO: 'UBG', UROBILINOGEN: 'UBG', UROBIL: 'UBG',
  NIT: 'Nitrite', NITRITE: 'Nitrite',
  LEU: 'LEU', LEUKOCYTEESTERASE: 'LEU', LEUESTERASE: 'LEU',
  // UA(요검사) 섹션 전용 소변 항목 canonical 의 멱등화(normalizeToken 이 '-' 를 지우므로 U-pH→UPH).
  //  raw "pH"→"U-pH" 같은 위험 매핑은 전역이 아니라 urinalysisSectionItemName(섹션 한정)에서만 한다.
  UPH: 'U-pH', UGLU: 'U-GLU', UPRO: 'U-PRO', UBIL: 'U-BIL', UKET: 'U-KET', UBLD: 'U-BLD', URBC: 'U-RBC', UWBC: 'U-WBC',
  COLOR: 'Color', COLOUR: 'Color', CLARITY: 'Clarity',
  // 소변 화학(분석기가 혈액과 같은 표에 찍는다 — IDEXX Catalyst UPC 클립 등). 소변 샘플이 있어야 값이 나온다.
  UPC: 'UPC', UPCR: 'UPC', UPCRATIO: 'UPC',
  UCRE: 'U-CRE', UCREA: 'U-CRE', UCREAT: 'U-CRE',
  // 혈중 요소(Urea). BUN 과 같은 물질이지만 단위·수치 체계가 달라(BUN mg/dL vs UREA mmol/L)
  //  한 항목으로 합치지 않는다 — 합치면 추이 그래프에 두 체계 값이 섞인다.
  UREA: 'UREA', BUNUREA: 'UREA',
  // 심장 트로포닌 I (Cardiac Troponin I) — chemistry. cTnI/cTnl(OCR)·troponin 표기 흡수.
  CTNI: 'cTnI', CTNL: 'cTnI', TNI: 'cTnI', CTROPONIN: 'cTnI', CTROPONINI: 'cTnI', TROPONIN: 'cTnI', TROPONINI: 'cTnI',
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
  // OCR이 산소분압 계열의 대문자 O 를 숫자 0 으로 잘못 읽는 경우(pO2→p02, sO2→s02 등) 흡수.
  P02: 'pO2',
  S02: 'SO2',
  PC02: 'pCO2',
  TC02: 'tCO2',
  HCO3: 'HCO3',
  HC03: 'HCO3', // OCR 이 O 를 0 으로 읽은 실제 중탄산염(표준중탄산염은 PRIORITY_RULES 가 먼저 분리)
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
  // ACTH 자극검사 자극 전/후 코르티솔 — 붙임형·"~Cortisol" 접미형 백업(괄호형은 PRIORITY_RULES 가 처리).
  PREACTH: 'Pre-ACTH',
  POSTACTH: 'Post-ACTH',
  PREACTHCORTISOL: 'Pre-ACTH',
  POSTACTHCORTISOL: 'Post-ACTH',
  BASELINECORTISOL: 'Pre-ACTH',
  BASALCORTISOL: 'Pre-ACTH',
};

/**
 * OCR이 라틴 글자를 같은 모양의 그리스/키릴 글자로 잘못 읽는 경우가 있다(예: "MONO"→"ΜΟΝΟ").
 * 검사 항목명은 관례상 ASCII이므로, 룩얼라이크 글자를 라틴으로 접어 정규화 매칭이 되게 한다.
 * (canonicalizeLabItemName 진입부에서 적용 → PRIORITY_RULES·CBC 차등·alias 매칭 전부 커버)
 */
const HOMOGLYPH_TO_LATIN: Record<string, string> = {
  // Greek 대문자 → Latin
  Α: 'A', Β: 'B', Ε: 'E', Ζ: 'Z', Η: 'H', Ι: 'I', Κ: 'K', Μ: 'M', Ν: 'N', Ο: 'O', Ρ: 'P', Τ: 'T', Υ: 'Y', Χ: 'X',
  // Greek 소문자 → Latin
  α: 'a', β: 'b', ε: 'e', ι: 'i', κ: 'k', μ: 'm', ν: 'n', ο: 'o', ρ: 'p', τ: 't', υ: 'u', χ: 'x', η: 'n',
  // Cyrillic 대문자 → Latin
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X',
  // Cyrillic 소문자 → Latin
  а: 'a', в: 'b', е: 'e', к: 'k', м: 'm', н: 'n', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x',
};

function foldOcrHomoglyphs(s: string): string {
  let out = '';
  for (const ch of s) out += HOMOGLYPH_TO_LATIN[ch] ?? ch;
  return out;
}

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
    normalized === 'QPL' || // 플러스벳 등 EMR 의 정량 췌장 리파아제 표기 — 개 cPL / 고양이 fPL
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
  // 미성숙과립구(Immature Granulocytes): IMG#(절대값)→'IMG', IMG%(백분율)→'IMG(%)'
  IMG: 'IMG', IMMATUREGRANULOCYTE: 'IMG', IMMATUREGRANULOCYTES: 'IMG',
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
  rawName: string | null | undefined,
  species?: LabCanonicalizeSpecies | null,
): string {
  const raw = foldOcrHomoglyphs((rawName ?? '').trim());
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
    'WBC', 'RBC', 'HGB', 'HCT', 'PLT', 'PLT-I', 'PLT-O', 'MCV', 'MCH', 'MCHC', 'RDW', 'RDW-CV', 'RDW-SD', 'PDW', 'PDW-CV', 'MPV',
    'NEU', 'LYM', 'MONO', 'MON', 'MID', 'GRA', 'IMG', 'EOS', 'BASO', 'RETIC', 'RET-He', 'IRF', 'LFR', 'MFR', 'HFR', 'PCT', 'PLT-LCR', 'PLT-LCC', 'IPF',
    '%NEU', '%LYM', '%MONO', '%EOS', '%BASO', '%RETIC', 'NRBC', 'BANDS', 'Blood smear',
    'NEU(%)', 'LYM(%)', 'MONO(%)', 'MON(%)', 'MID(%)', 'GRA(%)', 'IMG(%)', 'EOS(%)', 'BASO(%)', 'RETIC(%)',
    // Chemistry
    'ALT', 'AST', 'ALP', 'GGT', 'ALB', 'TP', 'GLOB', 'ALB/GLOB', 'BUN', 'CREA', 'BUN/CREA', 'SDMA', 'GLU',
    'TBIL', 'DBIL', 'TBA', 'TCHO', 'CHOL', 'TRIG', 'AMYL', 'LIPA', 'CK', 'TLI', 'NH3', 'FRUC', 'OSM', 'OSM CA',
    'CKMB', 'proBNP', 'NT-proBNP', 'cTnI', 'SDH', 'GLDH', 'URIC', 'UREA',
    // Electrolyte
    'NA', 'K', 'CL', 'CA', 'iCA', 'iCA(7.4)', 'PHOS', 'MG', 'NA/K', 'AG',
    // Urinalysis (요검사) — 소변 고유 항목만
    'SG', 'UBG', 'Nitrite', 'LEU',
    // UA 섹션 전용(섹션 헤더로 소변 확정 시 사용하는 소변 전용 이름)
    'U-pH', 'U-GLU', 'U-PRO', 'U-BIL', 'U-KET', 'U-BLD', 'U-RBC', 'U-WBC', 'U-URIC', 'Color', 'Clarity',
    'UPC', 'U-CRE',
    // Coagulation
    'PT', 'aPTT', 'TT', 'D-dimer', 'FDP', 'AT III', 'BMBT', 'Platelet func',
    // Hormone
    'T4', 'T3', 'fT4', 'TSH', 'Cortisol', 'ACTH', 'Pre-ACTH', 'Post-ACTH', 'LDDS', 'HDDS', 'INSULIN', 'FRU', 'PROGESTERONE', 'E2',
    'TESTOSTERONE', 'AMH', 'IGF1', 'PTH', 'ALD', 'RENIN',
    // Inflammatory
    'CRP', 'SAA', 'HP', 'FIB', 'Ferritin', 'cPL', 'fPL', 'PL',
    // Infectious
    'FELV', 'FIV', 'FeLV Ag', 'FIV Ab', 'FPV', 'CPV', 'CDV', 'HWAG', 'HW Ag', 'Coronavirus', 'FCoV Ab',
    'FIP PCR', 'Ehrlichia', 'Anaplasma', 'Babesia', 'Lyme', 'Lepto', 'Toxo', 'PCR',
    // Blood gas
    'pH', 'pCO2', 'pO2', 'BE', 'HCO3', 'HCO3(std)', 'tCO2', 'SO2', 'Lactate', 'tHb',
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

// ===== 단위(unit) 문자열 정규화 =====
// OCR/전사가 단위를 흔히 깨뜨린다: 곱셈기호(× → x), 마이크로(μ/µ → u), mol 끝 l 누락(umol→umo),
// 지수 표기 불일치(10x9·10*9·10^9). 표시·집계 일관성을 위해 결정적으로 한 번 정규화한다.
// 알려진 단위는 표준 표기로 매핑하고, 모르는 단위는 정리만 해서 그대로 돌려준다(값·범위는 건드리지 않음).
const UNIT_DISPLAY: Record<string, string> = {
  '10^9/l': '10^9/L', '10^12/l': '10^12/L', '10^10/l': '10^10/L',
  '10^3/ul': '10^3/uL', '10^6/ul': '10^6/uL',
  'k/ul': 'K/uL', 'm/ul': 'M/uL',
  'g/dl': 'g/dL', 'mg/dl': 'mg/dL', 'ug/dl': 'ug/dL', 'mg/l': 'mg/L',
  'ng/ml': 'ng/mL', 'pg/ml': 'pg/mL', 'ug/ml': 'ug/mL', 'pg': 'pg',
  'mmol/l': 'mmol/L', 'umol/l': 'umol/L', 'pmol/l': 'pmol/L', 'nmol/l': 'nmol/L',
  'meq/l': 'mEq/L', 'miu/l': 'mIU/L', 'iu/l': 'IU/L', 'u/l': 'U/L',
  'mmhg': 'mmHg', 'fl': 'fL', 'ul': 'uL', 'l': 'L', '%': '%',
};

export function canonicalizeLabUnit(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let s = String(raw).replace(/\s+/g, '').trim();
  if (!s || /^[-–—]+$/.test(s)) return null; // 빈 값·단독 대시는 단위 없음
  // 라틴 동형 그리스/키릴 대문자(단위 속 K·M) → 라틴
  s = s.replace(/[ΚК]/g, 'K').replace(/[ΜМ]/g, 'M');
  // 마이크로 기호(그리스 μ·micro µ) → u
  s = s.replace(/[μµ]/g, 'u');
  // 곱셈·지수 표기 통일: 10x9 / 10×9 / 10*9 / 10E9 / 10^9 → 10^9
  s = s.replace(/10[x×*eE^](\d{1,2})/g, '10^$1');
  // mol 끝 l 누락 보정: umo/L → umol/L, mmo/L → mmol/L, mo/L → mol/L
  s = s.replace(/mo\/l$/i, 'mol/L');
  return UNIT_DISPLAY[s.toLowerCase()] ?? s;
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
  { key: 'urinalysis', label: 'Urinalysis (요검사)', shortLabel: 'Urinalysis', order: 11 },
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
  'PLT-I': 'cbc',
  'PLT-O': 'cbc',
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
  IMG: 'cbc',
  // CBC 차등 백분율 (canonical: X(%))
  'NEU(%)': 'cbc',
  'LYM(%)': 'cbc',
  'MONO(%)': 'cbc',
  'MON(%)': 'cbc',
  'MID(%)': 'cbc',
  'GRA(%)': 'cbc',
  'IMG(%)': 'cbc',
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
  'PLT-LCC': 'cbc',
  IPF: 'cbc',
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
  tHb: 'blood_gas',
  // Urinalysis (요검사) — 소변 고유 항목
  SG: 'urinalysis',
  UBG: 'urinalysis',
  Nitrite: 'urinalysis',
  LEU: 'urinalysis',
  // UA 섹션 전용(섹션으로 소변 확정된 항목)
  'U-pH': 'urinalysis', 'U-GLU': 'urinalysis', 'U-PRO': 'urinalysis', 'U-BIL': 'urinalysis',
  'U-KET': 'urinalysis', 'U-BLD': 'urinalysis', 'U-RBC': 'urinalysis', 'U-WBC': 'urinalysis',
  'U-URIC': 'urinalysis',
  Color: 'urinalysis', Clarity: 'urinalysis',
  // 소변 화학 — 소변 샘플 필요(혈액과 같은 표에 찍혀 나와도 소변 항목).
  UPC: 'urinalysis',
  'U-CRE': 'urinalysis',
  UCRE: 'urinalysis',
  // 혈액 요산(Uric acid)
  URIC: 'chemistry',
  URICACID: 'chemistry',
  // 혈중 요소(Urea) — BUN 과 별개 항목으로 둔다.
  UREA: 'chemistry',
  OSM: 'chemistry',
  'OSM CA': 'chemistry',
  OSMCA: 'chemistry',
  OSMOLALITY: 'chemistry',
  CKMB: 'chemistry',
  cTnI: 'chemistry',
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
  iCA: 'electrolyte',
  'iCA(7.4)': 'electrolyte',
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
  'Pre-ACTH': 'hormone',
  'Post-ACTH': 'hormone',
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
  'HCO3(std)': 'blood_gas',
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

export function labItemCategory(itemName: string | null | undefined, species?: SpeciesProfile): LabCategory {
  const canonical = canonicalizeLabItemName(itemName, species);
  const key = ITEM_TO_CATEGORY[canonical] ?? ITEM_TO_CATEGORY[(itemName ?? '').trim()];
  if (key) return CATEGORY_BY_KEY.get(key)!;
  return CATEGORY_BY_KEY.get('other')!;
}

export function labCategorySortOrder(categoryKey: string): number {
  return CATEGORY_BY_KEY.get(categoryKey)?.order ?? 99;
}

// ── 요검사(UA) 섹션 전용 항목 매핑 ──────────────────────────────────────────
// 섹션 헤더(예: "UA Analysis")로 "이 블록은 소변"이 확정됐을 때만 쓴다. 이름만으론 혈액과 구분이
// 안 되는 항목(pH/GLU/PRO/BIL/KET/BLD/RBC/WBC)을 소변 전용 이름(U-*)으로 돌려 혈액과 겹치지 않게 한다.
const URINALYSIS_SECTION_MAP: Record<string, string> = {
  PH: 'U-pH',
  GLU: 'U-GLU', GLUCOSE: 'U-GLU',
  PRO: 'U-PRO', PROTEIN: 'U-PRO',
  BIL: 'U-BIL', BILIRUBIN: 'U-BIL',
  KET: 'U-KET', KETONE: 'U-KET', KETONES: 'U-KET',
  BLD: 'U-BLD', BLOOD: 'U-BLD', ERY: 'U-BLD', OB: 'U-BLD', OCCULTBLOOD: 'U-BLD',
  RBC: 'U-RBC', WBC: 'U-WBC',
  LEU: 'LEU', LEUKOCYTE: 'LEU', LEUKOCYTES: 'LEU',
  SG: 'SG', USG: 'SG', SPGR: 'SG', SPECIFICGRAVITY: 'SG',
  UBG: 'UBG', URO: 'UBG', UROBILINOGEN: 'UBG',
  NIT: 'Nitrite', NITRITE: 'Nitrite',
  // 소변 요산 — 섹션으로 소변이 확정됐을 때만. 혈액 요산(URIC, chemistry)과 섞이지 않게 U-URIC 으로.
  URIC: 'U-URIC', URICACID: 'U-URIC',
  COLOR: 'Color', COLOUR: 'Color',
  CLAR: 'Clarity', CLARITY: 'Clarity', TURBIDITY: 'Clarity', APPEARANCE: 'Clarity',
};
// 검사값이 아닌 메타(채취법 등) → 드롭(정규화 안 된 항목으로도 남기지 않는다).
const URINALYSIS_SECTION_DROP = new Set(['COLLEC', 'COLLECTION', 'METHOD', 'CHAICHUI', '채취', '채취법', 'SPECIMEN', 'SAMPLE']);

/**
 * UA(요검사) 섹션 안에서 나온 항목명을 소변 전용 canonical 로 변환.
 *  - 문자열 반환: 그 이름으로 저장(U-* 또는 SG/UBG/Color/Clarity 등).
 *  - null 반환: 드롭(검사값 아님, 예: 채취법 Collec).
 *  - 매핑에 없는 항목은 원문을 그대로 반환(그대로 저장 — 'other' 로 표시될 수 있음).
 */
export function urinalysisSectionItemName(rawItemName: string): string | null {
  const t = normalizeToken(rawItemName);
  if (!t) return null;
  if (URINALYSIS_SECTION_DROP.has(t)) return null;
  return URINALYSIS_SECTION_MAP[t] ?? rawItemName.trim();
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

/** 값 텍스트에서 순수 숫자값을 뽑는다(천단위 콤마 제거). 정성결과(Positive 등)·빈값이면 null. */
function parsePlainValue(valueText: string | null | undefined): number | null {
  const t = (valueText ?? '').replace(/,/g, '').trim();
  if (!t) return null;
  const m = t.match(/^[-+]?\d+(?:\.\d+)?$/) ?? t.match(/-?\d+(?:\.\d+)?/);
  return m ? Number.parseFloat(m[0]) : null;
}

/**
 * 값과 참고범위를 비교해 플래그를 "사후 계산"한다(차트에 H/L 마커가 없을 때 보충용).
 * - 부등호 값(>N, <N)은 refineLabFlag 로직 재사용.
 * - 일반 숫자값: 값<하한→low, 값>상한→high, 범위 안→normal.
 * - 판정 불가(값/범위 파싱 불가, 한쪽 경계만 있고 그 경계 밖도 아님)는 unknown 그대로.
 *   ※ 호출 측은 보통 flag 가 unknown 인 항목에만 적용한다(범위 없어 빈 값인 항목은 제외).
 */
export function computeLabFlag(
  valueText: string,
  referenceRange: string | null | undefined,
): LabFlag {
  const ineq = refineLabFlag('unknown', valueText, referenceRange);
  if (ineq !== 'unknown') return ineq;
  const v = parsePlainValue(valueText);
  if (v === null) return 'unknown';
  const { low, high } = parseRefRange(referenceRange);
  if (low === null && high === null) return 'unknown';
  if (high !== null && v > high) return 'high';
  if (low !== null && v < low) return 'low';
  if (low !== null && high !== null) return 'normal';
  if (high !== null && v <= high) return 'normal';
  if (low !== null && v >= low) return 'normal';
  return 'unknown';
}
