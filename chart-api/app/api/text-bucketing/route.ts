import { NextRequest } from "next/server";
import { chartAppAuthMiddleware } from "@/lib/chart-app/auth";
import { writeFileSync } from "fs";
import { generateAndSaveAssessment } from "@/lib/run-ai-assessment-llm";
import { assignLinesToBuckets } from "@/lib/text-bucketing/assign-buckets";
import {
  parseVaccinationRecordsFromBucketLines,
  type ParsedVaccinationRecord,
} from "@/lib/text-bucketing/vaccination-parse";
import { parsePlusVetLabBucketLines, isUrinalysisPanelHeaderText } from "@/lib/text-bucketing/plusvet-lab-parse";
import { parsePlusVetPlanRows } from "@/lib/text-bucketing/plusvet-plan-parse";
import {
  extractEfriendsLabAndPhysicalExamBuckets,
  parseEfriendsLabItemsFromBucketLines,
} from "@/lib/text-bucketing/efriends-lab-extract";
import {
  isEfriendsPdfFooterDateTimeLine,
  isEfriendsPdfFooterPageLine,
  isEfriendsRepeatingPdfHeaderLine,
} from "@/lib/text-bucketing/efriends-pdf-noise";
import { chartTypeNoticeFor, parseChartKind, type ChartKind } from "@/lib/text-bucketing/chart-kind";
import { finalizeBasicInfoBirthAndAge } from "@/lib/patient-birth-age";
import {
  extractChartBodyDateKey,
  extractEfriendsVisitDateKey,
  extractLabDateTime,
  extractPlusVetVisitDateKey,
  extractWoorienLooseVisitDateTime,
  extractWoorienChartBodyVisitDate,
} from "@/lib/text-bucketing/chart-dates";
import { runGoogleVisionOcr, type OcrRow } from "@/lib/google-vision";
import { extractOrderedLinesFromPdf, getOpenAiOrderedLinesModel, reconstructPlanRowsFromText } from "@/lib/report-llm";
import { extractOrderedLinesFromTextLayer, isTextLayerSufficient } from "@/lib/text-bucketing/pdf-text-layer";
import { hospitalHasTokens, chargeOperationTokens } from "@/lib/billing/token-charge";
import { extractOpenAiErrorDetails, exposeOpenAiErrorDetailsInResponse } from "@/lib/openai-api-error";
import { hasLlmApiKey } from "@/lib/llm-provider";
import { detectTableBlocks, extractLabItems, rowsFromTableBlocks } from "@/lib/lab-parser";
import { extractLabItemsWithLlm } from "@/lib/lab-llm";
import type { LabItem } from "@/lib/lab-parser";
import { createHash } from "node:crypto";
import { assignFriendlyIdToParseRun } from "@/lib/friendly-id";
import { normalizeBasicInfoSpeciesBreed } from "@/lib/basic-info-normalization";
import { PDF_UPLOAD_BUCKET } from "@/lib/supabase-storage-buckets";
import { getPdfPageCount, mergePdfs } from "@/lib/pdf-slice-pages";
import { hospitalsDbUsesCamelCase } from "@/lib/hospital-db";
import { dbChartPdf, dbCore, getSupabaseCoreSchema } from "@/lib/supabase-db-schema";
import { getChartPgPool } from "@/lib/db";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { canonicalizeLabItemName, canonicalizeLabUnit } from "@/lib/lab-item-normalize";
import { computeLabFlag, refineLabFlag, urinalysisSectionItemName } from "@dashboard/lab-normalize";
import { detectSpeciesProfile } from "@/lib/lab-category-map";
import {
  efriendsChartBodyByDateFromBlocks,
  efriendsChartBodyByDateFromComposedPaste,
  parseEfriendsChartBlocksFromFormJson,
} from "@/lib/text-bucketing/compose-efriends-chart-paste";

export const runtime = "nodejs";
// OCR + LLM(순서있는 줄 추출) + 버켓팅 — 다중 PDF 머지 시 길어질 수 있어 상한 명시(Pro 최대 800).
export const maxDuration = 800;

const MAX_FILE_SIZE_BYTES = 30 * 1024 * 1024;
const EXTRACT_UPLOAD_BUCKET = PDF_UPLOAD_BUCKET;

const HOSPITAL_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type OrderedLine = { page: number; text: string };
type BucketName = "basicInfo" | "chartBody" | "vaccination" | "lab" | "vitals";
type BucketedLine = {
  page: number;
  text: string;
  corrected: boolean;
  originalText?: string;
};

type ChartBodyByDateGroup = {
  dateTime: string;
  pages: number[];
  bodyText: string;
  planText: string;
  lineCount: number;
  planDetected: boolean;
};

type LabByDateGroup = {
  dateTime: string;
  pages: number[];
  text: string;
  lineCount: number;
};

type LabByDateLinesGroup = {
  dateTime: string;
  lines: BucketedLine[];
  /** 이 날짜 그룹의 패널 헤더가 요검사(UA)였는지 — 헤더 줄은 그룹핑에서 떨어져 나가므로 여기 보존해 파서에 전달. */
  isUrinalysis?: boolean;
};

type ParsedPlanRow = {
  code: string;
  treatmentPrescription: string;
  qty: string;
  unit: string;
  day: string;
  total: string;
  route: string;
  signId: string;
  raw: string;
};

type ParsedBasicInfo = {
  hospitalName: string | null;
  ownerName: string | null;
  patientName: string | null;
  species: string | null;
  breed: string | null;
  birth: string | null;
  sex: string | null;
};

type ParsedVitalRow = {
  dateTime: string;
  weight: string | null;
  temperature: string | null;
  respiratoryRate: string | null;
  heartRate: string | null;
  bpSystolic: string | null;
  bpDiastolic: string | null;
  rawText: string;
};

type ParsedPhysicalExamItem = {
  dateTime: string;
  itemName: string;
  referenceRange: string | null;
  valueText: string;
  unit: string | null;
  rawText: string;
};

type DebugTrace = {
  labDebugEnabled: boolean;
  llmLabLines: string[];
  ocrLabRows: string[];
  bucketLabLines: string[];
  groupedLabLines: Array<{ dateTime: string; lines: string[] }>;
  extractedLabItems: Array<{ itemName: string; valueText: string; unit: string | null; flag: string }>;
  unmatchedLabItems?: Array<{
    itemName: string;
    valueText: string;
    hasAnyNameMatch: boolean;
    hasAnyValueMatch: boolean;
    candidateGroupsByName: string[];
  }>;
};

function cleanNoise(line: string | null | undefined) {
  const trimmed = (line ?? "").trim();
  if (!trimmed) return null;
  if (/^printed\s*:/i.test(trimmed)) return null;
  if (/^page\s+\d+\s+of\s+\d+$/i.test(trimmed)) return null;
  /** 이프렌즈 PDF 등: `Page: 0`, `page: 12` */
  if (/^page\s*:\s*\d+\s*$/i.test(trimmed)) return null;
  return trimmed;
}

/** eFriends 등: 복사한 차트 본문을 PDF 추출 줄 앞에 붙일 때 사용 (page 0, 순서는 배열 기준). */
export function orderedLinesFromPastedChartText(raw: string, chartKind?: ChartKind): OrderedLine[] {
  const out: OrderedLine[] = [];
  for (const part of raw.split(/\r?\n/)) {
    let cleaned = cleanNoise(part);
    if (chartKind === "efriends" && cleaned) {
      if (isEfriendsPdfFooterDateTimeLine(cleaned)) cleaned = null;
      if (cleaned && isEfriendsPdfFooterPageLine(cleaned)) cleaned = null;
      if (cleaned && isEfriendsRepeatingPdfHeaderLine(cleaned)) cleaned = null;
    }
    if (cleaned) out.push({ page: 0, text: cleaned });
  }
  return out;
}

function normalizeBasicInfoSex(value: string | null): string | null {
  if (!value) return null;
  const t = value.trim();

  // eFriends EMR 등: C.male(중남)=중성화 수컷, S.female(중여)=중성화 암컷, Male(남)=수컷, Female(여)=암컷
  // 점·슬래시·전각 문자·괄호 OCR 변형 허용
  const neuterMaleEf =
    /\bc[\s.．·\/]*male\b/i.test(t) ||
    /\(\s*중남\s*\)/.test(t) ||
    /（\s*중남\s*）/.test(t) ||
    /^중남$/i.test(t) ||
    (/\b중남\b/i.test(t) && /\bmale\b/i.test(t));
  const neuterFemaleEf =
    /\bs[\s.．·\/]*female\b/i.test(t) ||
    /\(\s*중여\s*\)/.test(t) ||
    /（\s*중여\s*）/.test(t) ||
    /^중여$/i.test(t) ||
    (/\b중여\b/i.test(t) && /\bfemale\b/i.test(t));
  if (neuterMaleEf) return "수컷(중성화)";
  if (neuterFemaleEf) return "암컷(중성화)";

  if (/male\s*[（(]\s*남\s*[）)]/i.test(t)) return "수컷";
  if (/female\s*[（(]\s*여\s*[）)]/i.test(t)) return "암컷";

  const isNeuter = /neut|spay|castrat|\bfs\b|\bmn\b|중성/i.test(t);
  const isFemale = /(female|암컷|암|\bf\b)/i.test(t);
  const isMale = /(male|수컷|수|\bm\b)/i.test(t) && !isFemale;

  if (isNeuter && isFemale) return "암컷(중성화)";
  if (isNeuter && isMale) return "수컷(중성화)";
  if (isFemale) return "암컷";
  if (isMale) return "수컷";
  return t;
}

/** 이프렌즈 PDF/복사본: 성별이 라벨 줄과 값 줄로 나뉘거나 콜론 없이 오는 경우가 많음 */
function extractEfriendsSexRaw(filtered: string[], fullBlock: string): string | null {
  const skipValue = (v: string) =>
    !v ||
    /^(information|client|patient|owner|species|breed|birth|dob|sex|gender)$/i.test(v);

  const linePatterns: RegExp[] = [
    /** 이프렌즈 한글 UI: `성: S.Female(중여)` — `성별`이 아닌 단독 `성` 라벨 */
    /^성\s*[:：﹕∶]\s*(.+)$/i,
    /^(?:sex|gender|성별|sex\s*[/／]\s*gender)\s*[:：﹕∶]?\s*(.+)$/i,
    /^(?:환자\s*성별|pet\s*sex|animal\s*sex)\s*[:：﹕∶]?\s*(.+)$/i,
    /^(?:sex|gender|성별)\s+(.+)$/i,
  ];
  for (const line of filtered) {
    for (const re of linePatterns) {
      const m = line.match(re);
      if (!m?.[1]) continue;
      const v = m[1].trim();
      if (skipValue(v)) continue;
      return v;
    }
  }

  for (let i = 0; i < filtered.length - 1; i++) {
    if (
      !/^(?:sex|gender|성별|성|환자\s*성별|sex\s*[/／]\s*gender)\s*[:：﹕∶]?\s*$/i.test(filtered[i])
    ) {
      continue;
    }
    const next = filtered[i + 1].trim();
    if (skipValue(next)) continue;
    if (/^(patient|owner|species|breed|birth|dob|나이|종|품종|축종)/i.test(next)) continue;
    return next;
  }

  const earlyFlat = filtered.slice(0, 50).join("\n");
  const blockMatch = earlyFlat.match(
    /(?:^|\n)\s*(?:sex|gender|성별|성|환자\s*성별)\s*[:：﹕∶]?\s*([^\n\r]+)/im,
  );
  if (blockMatch?.[1]) {
    const v = blockMatch[1].trim();
    if (!skipValue(v)) return v;
  }

  const head = earlyFlat.slice(0, 3000);
  /** 끝 `\b` 제거: `S.Female(중여)` 다음이 줄바꿈이면 `)`와 `\n` 사이에 word boundary가 없어 매칭 실패하던 문제 */
  const token = head.match(
    /\b(C[\s.．·\/]*male(?:（[^）]*）|\([^\)]*\))?|S[\s.．·\/]*female(?:（[^）]*）|\([^\)]*\))?)/i,
  );
  if (token?.[1] && !skipValue(token[1].trim())) return token[1].trim();

  const mf = head.match(/\b(Male\s*[（(][^）)]*[）)]|Female\s*[（(][^）)]*[）)])\b/i);
  if (mf?.[1]) return mf[1].trim();

  return null;
}

const PLUSVET_HOSPITAL_LINE_HINT = /동물병원|동물메디컬센터|동물의료센터/;

const PLUSVET_LABEL_FIELD_MAP: Record<string, string> = {
  "동물명": "patientName",
  "축종/품종": "speciesBreed",
  "나이": "birth",
  "보호자 성함": "ownerName",
  "보호자성함": "ownerName",
  "보호자명": "ownerName",
  "보호자": "ownerName",
  "동물 등록 번호": "registration",
  "동물등록번호": "registration",
  "연락처": "contact",
  "주소": "address",
  "성별": "sex",
};

function normalizeForLabelLookup(s: string): string {
  return s.replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ").trim();
}

/**
 * PlusVet basicInfo: OCR이 라벨을 묶어서 먼저 출력한 뒤 값을 묶어 출력하는 경우에도
 * FIFO 큐로 순서를 보존해 올바르게 매칭한다.
 * `나이` 값(예: `13Y OM`)은 `birth` 키에 두고, 저장 시 `finalizeBasicInfoBirthAndAge`가 정규화한다.
 */
function parsePlusVetBasicInfoFromText(block: string): ParsedBasicInfo {
  const rawLines = block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  let hospitalName: string | null = null;
  for (const line of rawLines) {
    if (PLUSVET_HOSPITAL_LINE_HINT.test(line)) {
      hospitalName = line;
      break;
    }
  }

  // 긴 라벨 먼저 — "보호자"가 "보호자 성함" 앞에 매칭되는 것을 방지
  const sortedLabels = Object.entries(PLUSVET_LABEL_FIELD_MAP)
    .sort(([a], [b]) => b.length - a.length);

  const extracted: Record<string, string> = {};
  const pending: string[] = []; // FIFO 큐: 아직 값을 못 받은 라벨(필드명) 목록

  for (const line of rawLines) {
    const normalized = normalizeForLabelLookup(line);

    // Case 1: 라벨만 있는 줄 → 큐에 push
    const exactField = PLUSVET_LABEL_FIELD_MAP[normalized];
    if (exactField !== undefined) {
      pending.push(exactField);
      continue;
    }

    // Case 2: 한 줄에 "라벨 값 [라벨 값 …]" 여러 쌍이 올 수 있다(표가 한 줄로 합쳐진 경우:
    //  "보호자 성함 권숙자 동물명 콩"). 줄 안 모든 라벨 위치를 찾고(긴 라벨 우선·단어경계),
    //  각 값 = 다음 라벨 직전까지로 자른다. 단일 쌍 줄도 동일하게 동작(값=줄 끝까지).
    const labelHits: Array<{ field: string; valueStart: number; matchStart: number }> = [];
    for (let p = 0; p < normalized.length; ) {
      let hit: { label: string; field: string } | null = null;
      for (const [label, field] of sortedLabels) {
        if (
          normalized.startsWith(label, p) &&
          (p + label.length >= normalized.length || normalized[p + label.length] === " ")
        ) {
          hit = { label, field };
          break; // 긴 라벨 우선(정렬돼 있음)
        }
      }
      if (hit) {
        labelHits.push({ field: hit.field, valueStart: p + hit.label.length, matchStart: p });
        p += hit.label.length;
      } else {
        p += 1;
      }
    }
    if (labelHits.length > 0) {
      for (let k = 0; k < labelHits.length; k += 1) {
        const valueEnd = k + 1 < labelHits.length ? labelHits[k + 1].matchStart : normalized.length;
        const value = normalized.slice(labelHits[k].valueStart, valueEnd).trim();
        if (value && !extracted[labelHits[k].field]) extracted[labelHits[k].field] = value;
      }
      continue;
    }

    // Case 3: 값 줄 → 큐에서 꺼내 매칭
    if (pending.length > 0) {
      const target = pending.shift()!;
      if (!extracted[target]) extracted[target] = line;
    }
    // pending이 비어있으면 병원명/주소 등 헤더로 간주하고 무시
  }

  const speciesBreedRaw = extracted["speciesBreed"] ?? null;
  let species: string | null = null;
  let breed: string | null = null;
  if (speciesBreedRaw) {
    const idx = speciesBreedRaw.indexOf("/");
    if (idx >= 0) {
      species = speciesBreedRaw.slice(0, idx).trim() || null;
      breed = speciesBreedRaw.slice(idx + 1).trim() || null;
    } else {
      species = speciesBreedRaw;
    }
  }

  return {
    hospitalName,
    ownerName: extracted["ownerName"] ?? null,
    patientName: extracted["patientName"] ?? null,
    species,
    breed,
    birth: extracted["birth"] ?? null,
    sex: normalizeBasicInfoSex(extracted["sex"] ?? null),
  };
}

function parseEfriendsBasicInfoFromText(block: string): ParsedBasicInfo {
  const lines = block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const filtered = lines.filter((line) => !/^client\s*&\s*patient\s+information$/i.test(line));
  const pickByLabel = (patterns: RegExp[]): string | null => {
    for (const line of filtered) {
      for (const re of patterns) {
        const m = line.match(re);
        if (!m?.[1]) continue;
        const v = m[1].trim();
        if (!v) continue;
        if (/^(information|client|patient|owner|species|breed|birth|dob|sex)$/i.test(v)) continue;
        return v;
      }
    }
    return null;
  };
  const normalizeCompactDate = (value: string): string | null => {
    const t = value.trim();
    const compact = t.match(/\b(19\d{2}|20\d{2})(0[1-9]|1[0-2])([0-2]\d|3[01])\b/);
    if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
    const ymd = t.match(/\b(19\d{2}|20\d{2})[./-](\d{1,2})[./-](\d{1,2})\b/);
    if (!ymd) return null;
    const m = String(Number.parseInt(ymd[2] ?? "0", 10)).padStart(2, "0");
    const d = String(Number.parseInt(ymd[3] ?? "0", 10)).padStart(2, "0");
    return `${ymd[1]}-${m}-${d}`;
  };
  const speciesRaw = pickByLabel([
    /^(?:species|종)\s*[:：]\s*(.+)$/i,
    /^(?:축종)\s*[:：]\s*(.+)$/i,
  ]);
  const breedRaw = pickByLabel([
    /^(?:breed|품종)\s*[:：]\s*(.+)$/i,
    /^(?:상세품종)\s*[:：]\s*(.+)$/i,
  ]);
  const sexRaw = extractEfriendsSexRaw(filtered, block);
  const birthRaw = pickByLabel([
    /^(?:birth|dob|생년월일|생일)\s*[:：]\s*(.+)$/i,
    /^(?:환자\s*생일)\s*[:：]\s*(.+)$/i,
  ]);

  return {
    hospitalName: null,
    ownerName: pickByLabel([/^(?:client|owner|보호자)\s*[:：]\s*(.+)$/i]),
    patientName: pickByLabel([/^(?:patient|환자)\s*[:：]\s*(.+)$/i]),
    species: speciesRaw,
    breed: breedRaw,
    birth: birthRaw ? normalizeCompactDate(birthRaw) ?? birthRaw : null,
    sex: normalizeBasicInfoSex(sexRaw),
  };
}

/**
 * 우리엔PMS Medical Record 기본정보 — `라벨: 값` 한 줄 단위 포맷.
 * 라벨이 우리 DB 필드와 다름:
 *   동물이름 → patientName(환자명), 종류 → species(종), 품종 → breed(품종).
 * 보호자명은 우리엔 Medical Record에 없으므로 항상 null(빈칸 유지).
 */
function parseWoorienPmsBasicInfoFromText(block: string): ParsedBasicInfo {
  const lines = block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  // 우리엔 Medical Record는 한 줄에 "라벨: 값 라벨: 값 …" 여러 쌍 + 우측에 병원 주소/전화가 붙는다.
  // (예: "동물번호: 202500500 동물이름: 라니 032-653-0119")
  // 라벨을 줄 어디서든 찾고, 값 = 다음 라벨 직전까지로 자른 뒤, 꼬리(옆 칸 전화/주소)를 제거한다.
  const ALL_LABELS = ["보호자번호","보호자이름","전화번호","동물번호","동물이름","종류","품종","성별","생일","생년월일","색상","RFID","현재체중","주소","동물명","종"];
  const nextRe = new RegExp(`\\s+(?:${ALL_LABELS.join("|")})\\s*[:：]`);
  const labelLineRe = new RegExp(`^(?:${ALL_LABELS.join("|")})\\s*[:：]`);
  const pick = (labels: string[]): string | null => {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      for (const label of labels) {
        const m = line.match(new RegExp(`${label}\\s*[:：]\\s*`));
        if (!m || m.index === undefined) continue;
        const after = line.slice(m.index + m[0].length);
        const nm = after.match(nextRe);
        let v = (nm && nm.index !== undefined ? after.slice(0, nm.index) : after).trim();
        // 값이 같은 줄에 없으면(라벨만 있는 줄 — 세로형 레이아웃) 바로 다음 줄을 값으로.
        //  다음 줄이 또 다른 라벨 줄이면 값 없음으로 본다.
        if (!v && i + 1 < lines.length) {
          const cand = lines[i + 1].trim();
          if (cand && !labelLineRe.test(cand)) v = cand;
        }
        if (v) return v;
      }
    }
    return null;
  };
  // 값 뒤에 붙은 옆 칸(병원 전화/주소) 제거
  const stripTrail = (v: string | null): string | null => {
    if (!v) return v;
    let out = v.replace(/\s+0?\d{1,3}-\d{3,4}-\d{4}.*$/, "");
    out = out.replace(/\s+(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)[\s\S]*$/, "");
    return out.trim() || null;
  };

  const hospitalName = lines.find((l) => /동물(메디컬|병원|의료|클리닉)|메디컬\s*센터/.test(l)) ?? null;
  const birthRaw = pick(["생일", "생년월일"]);
  const birth = birthRaw ? (birthRaw.match(/\d{4}[-.]\d{1,2}[-.]\d{1,2}/)?.[0] ?? null) : null;

  return {
    hospitalName,
    ownerName: stripTrail(pick(["보호자이름"])),
    patientName: stripTrail(pick(["동물이름", "동물명"])),
    species: stripTrail(pick(["종류", "종"])),
    breed: stripTrail(pick(["품종"])),
    birth,
    sex: normalizeBasicInfoSex(stripTrail(pick(["성별"]))),
  };
}

function parseBasicInfoFromText(
  fullText: string,
  chartKind: ChartKind = "intovet",
  basicInfoLines?: BucketedLine[],
): ParsedBasicInfo {
  const withNormalizedSpeciesBreed = (info: ParsedBasicInfo): ParsedBasicInfo => {
    const normalized = normalizeBasicInfoSpeciesBreed({
      species: info.species,
      breed: info.breed,
    });
    return {
      ...info,
      species: normalized.species,
      breed: normalized.breed,
    };
  };

  if (chartKind === "plusvet") {
    const block =
      basicInfoLines && basicInfoLines.length > 0
        ? basicInfoLines.map((l) => l.text).join("\n")
        : fullText;
    return withNormalizedSpeciesBreed(parsePlusVetBasicInfoFromText(block));
  }

  if (chartKind === "efriends") {
    // eFriends는 basicInfo 라인이 흩어질 수 있어 전체 텍스트를 우선 사용.
    const block = fullText;
    return withNormalizedSpeciesBreed(parseEfriendsBasicInfoFromText(block));
  }

  if (chartKind === "woorien_pms") {
    const block =
      basicInfoLines && basicInfoLines.length > 0
        ? basicInfoLines.map((l) => l.text).join("\n")
        : fullText;
    return withNormalizedSpeciesBreed(parseWoorienPmsBasicInfoFromText(block));
  }

  const lines = fullText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const labelTokens = [
    "Client No",
    "Client",
    "Owner",
    "Patient",
    "Species",
    "Breed",
    "Birth",
    "Sex",
    "Address",
    "Tel",
    "RFID",
    "Color",
    "보호자명",
    "보호자",
    "환자명",
    "환자",
    "품종",
    "상세품종",
    "생년월일",
    "생일",
    "성별",
  ];
  const escapedLabelAlternation = labelTokens
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");

  const pick = (keys: string[]) => {
    for (const key of keys) {
      const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Capture value even when multiple fields exist in one line:
      // e.g. "Client: A Client No: 123"
      const regex = new RegExp(
        `${escapedKey}\\s*[:：]\\s*(.+?)(?=\\s+(?:${escapedLabelAlternation})\\s*[:：]|\\n|$)`,
        "i",
      );
      const match = fullText.match(regex);
      if (match?.[1]) {
        const value = match[1].trim();
        if (value) return value;
      }
    }
    return null;
  };

  const result: ParsedBasicInfo = {
    hospitalName: null,
    ownerName: pick(["client", "owner", "보호자", "보호자명"]),
    patientName: pick(["patient", "환자", "환자명"]),
    species: pick(["species", "종", "품종"]),
    breed: pick(["breed", "상세품종"]),
    birth: pick(["birth", "dob", "생년월일", "생일", "환자 생일"]),
    sex: normalizeBasicInfoSex(pick(["sex", "gender", "성별", "환자 성별"])),
  };

  result.hospitalName = lines[0] ?? null;

  return withNormalizedSpeciesBreed(result);
}

/**
 * 이프렌즈: SOAP History 직후 `Client`/`S.E`/`Date` 단독 등은 섹션 헤더이며 unknown에 쌓이지 않게,
 * 첫 `Date: yyyy-mm-dd` + 근처 `Purpose of visit` 조합부터 본문으로 본다.
 */
function findEfriendsChartBodyContentStart(lines: BucketedLine[]): number {
  for (let i = 0; i < lines.length; i += 1) {
    const cur = lines[i].text.replace(/\s+/g, " ").trim();
    if (!/purpose\s+of\s+visit\s*:/i.test(cur)) continue;
    for (let j = Math.max(0, i - 4); j < i; j += 1) {
      const t = lines[j].text.replace(/\s+/g, " ").trim();
      if (/^date\s*:\s*20\d{2}[./-]\d{1,2}[./-]\d{1,2}\b/i.test(t)) return j;
    }
  }
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].text.replace(/\s+/g, " ").trim();
    if (!/^date\s*:\s*20\d{2}[./-]\d{1,2}[./-]\d{1,2}\b/i.test(t)) continue;
    const window = lines.slice(i, Math.min(lines.length, i + 6)).map((l) => l.text).join("\n");
    if (/purpose\s+of\s+visit\s*:/i.test(window)) return i;
  }
  return 0;
}

function groupChartBodyByDate(lines: BucketedLine[], chartKind: ChartKind): ChartBodyByDateGroup[] {
  const linesToGroup =
    chartKind === "efriends" && lines.length > 0
      ? lines.slice(findEfriendsChartBodyContentStart(lines))
      : lines;

  const groups = new Map<string, BucketedLine[]>();
  let currentKey = "unknown";

  // PlusVet 진료 그루핑: 두 신호를 함께 쓴다(둘 중 하나라도 있으면 진료 경계).
  //  (a) 진료 헤더(DATE | 재진/초진/… | 담당의) — Subjective 가 없는 진료(Plan만/Objective만 있는 날)도 잡는다.
  //      (영상/검사 시각은 진료유형 키워드가 없어 자연히 제외)
  //  (b) Subjective — 헤더가 셀로 쪼개져 (a)로 못 잡는 진료의 안정적 폴백.
  // 헤더로 그룹을 막 열었으면 그 직후 Subjective 는 같은 진료로 본다(중복 그룹 방지).
  const plusvetGroupable =
    chartKind === "plusvet" &&
    linesToGroup.some(
      (l) => extractPlusVetVisitDateKey(l.text.trim()) !== null || /^subjective\b/i.test(l.text.trim()),
    );
  const woorienSubjectiveAnchored =
    chartKind === "woorien_pms" && linesToGroup.some((l) => /^subjective\b/i.test(l.text.trim()));

  if (plusvetGroupable) {
    let pendingDate: string | null = null;
    let visitIdx = 0;
    let headerOpenedCurrent = false; // 현재 그룹이 진료 헤더로 열렸고 아직 Subjective 를 안 만남
    for (const line of linesToGroup) {
      const t = line.text.trim();
      const visitDate = extractPlusVetVisitDateKey(t);
      if (visitDate) {
        // (a) 진료 헤더 → 무조건 새 진료 (Plan만/Objective만 있는 날도 분리됨)
        visitIdx += 1;
        let key = visitDate;
        if (groups.has(key)) key = `${key} (${visitIdx})`;
        currentKey = key;
        groups.set(currentKey, []);
        pendingDate = visitDate;
        headerOpenedCurrent = true;
        continue; // 헤더 줄은 본문에 안 넣음
      }
      if (/^(?:\[)?\s*20\d{2}[./-]\d{1,2}[./-]\d{1,2}\s+\d{1,2}:\d{2}/.test(t)) {
        // 진료 헤더가 아닌 날짜시각(랩/영상 시각) — 키 후보로만 두고 본문 제외(누수 방지)
        const d = extractLabDateTime(t);
        if (d) pendingDate = d;
        continue;
      }
      if (/^subjective\b/i.test(t)) {
        if (headerOpenedCurrent) {
          // 방금 헤더로 연 진료의 Subjective → 같은 진료(새 그룹 X)
          headerOpenedCurrent = false;
          groups.get(currentKey)?.push(line);
        } else {
          // (b) 헤더 없이 온 Subjective → 새 진료
          visitIdx += 1;
          let key = pendingDate ?? `진료 ${visitIdx}`;
          if (groups.has(key)) key = `${key} (${visitIdx})`;
          currentKey = key;
          groups.set(currentKey, [line]);
        }
        continue;
      }
      if (currentKey === "unknown") continue; // 첫 진료 경계 이전(기본정보 등)은 버림
      groups.get(currentKey)?.push(line);
    }
    console.log(
      "[groupChartBodyByDate] plusvet grouped visits=%d keys=%s",
      visitIdx,
      JSON.stringify([...groups.keys()]),
    );
  } else if (woorienSubjectiveAnchored) {
    // 우리엔PMS: "날짜시각 줄 다음(1~3줄 내)에 Subjective" 가 진짜 진료 시각이다.
    // (날짜 줄과 Subjective 사이에 `Sign : 담당자` 등이 끼기도 함)
    // 날짜시각 줄(방문 헤더 + Chart Image/Device 블록의 EXIF 영상시각)은 모두 본문에서 제외하고,
    // 그 중 Subjective 가 곧 따라오는 줄만 새 방문 그룹의 키로 삼는다.
    let visitIdx = 0;
    let started = false;
    for (let i = 0; i < linesToGroup.length; i += 1) {
      const line = linesToGroup[i];
      const dateTime = extractWoorienChartBodyVisitDate(line.text);
      if (dateTime) {
        const subjectiveFollows = [1, 2, 3].some((d) =>
          /^subjective\b/i.test(linesToGroup[i + d]?.text.trim() ?? ""),
        );
        // 방문 경계 신호: (a) 곧 Subjective 가 따라옴(헤더형) 또는
        //  (b) 줄에 'Sign : 담당자' 서명이 있음(서명된 진료 = 실제 방문. EXIF 영상시각엔 서명 없음).
        const hasSignature = /\bSign\b\s*[:：]/i.test(line.text);
        if (subjectiveFollows || hasSignature) {
          visitIdx += 1;
          let key = dateTime;
          if (groups.has(key)) key = `${key} (${visitIdx})`;
          currentKey = key;
          groups.set(currentKey, []);
          started = true;
        }
        continue; // 날짜시각 줄은 본문에 넣지 않음(EXIF 영상시각·헤더 누수 방지)
      }
      if (!started) continue; // 첫 방문 헤더 이전 줄(기본정보 잔여 등)은 버림
      groups.get(currentKey)?.push(line);
    }
    console.log(
      "[groupChartBodyByDate] woorien subjectiveAnchored visits=%d keys=%s",
      visitIdx,
      JSON.stringify([...groups.keys()]),
    );
  } else {
    for (const line of linesToGroup) {
      const dateTime =
        chartKind === "efriends"
          ? extractEfriendsVisitDateKey(line.text) ?? extractChartBodyDateKey(line.text, chartKind)
          : extractChartBodyDateKey(line.text, chartKind);
      if (dateTime) {
        currentKey = dateTime;
        if (!groups.has(currentKey)) {
          groups.set(currentKey, []);
        }
        if (chartKind === "efriends") {
          const list = groups.get(currentKey) ?? [];
          list.push(line);
          groups.set(currentKey, list);
        }
        continue;
      }
      const list = groups.get(currentKey) ?? [];
      list.push(line);
      groups.set(currentKey, list);
    }
  }

  return [...groups.entries()]
    .filter(([dateTime, groupLines]) => dateTime !== "unknown" || groupLines.length > 0)
    .map(([dateTime, groupLines]) => {
    const texts = groupLines.map((line) => line.text);

    let bodyText: string;
    let planText: string;
    let planDetected: boolean;

    if (chartKind === "plusvet") {
      const soap = splitPlusVetSoapSections(texts);
      bodyText = soap.bodyText;
      planText = soap.planText;
      planDetected = soap.planDetected;
    } else {
      const planStart = findPlanStartIndex(texts, chartKind);
      bodyText = planStart >= 0 ? texts.slice(0, planStart).join("\n").trim() : texts.join("\n").trim();
      planText = planStart >= 0 ? texts.slice(planStart).join("\n").trim() : "";
      planDetected = planStart >= 0;
    }

    return {
      dateTime,
      pages: [...new Set(groupLines.map((line) => line.page))].sort((a, b) => a - b),
      bodyText,
      planText,
      lineCount: groupLines.length,
      planDetected,
    };
  })
  // 본문·플랜이 모두 빈 그룹은 랩/영상 시각 등으로 잘못 잡힌 노이즈라 버린다.
  .filter((g) => g.bodyText.trim().length > 0 || g.planText.trim().length > 0);
}

function groupLabByDate(lines: BucketedLine[]): LabByDateGroup[] {
  const grouped = groupLabLinesByDate(lines);
  return grouped.map((group) => ({
    dateTime: group.dateTime,
    pages: [...new Set(group.lines.map((line) => line.page))].sort((a, b) => a - b),
    text: group.lines.map((line) => line.text).join("\n").trim(),
    lineCount: group.lines.length,
  }));
}

function groupLabLinesByDate(lines: BucketedLine[]): LabByDateLinesGroup[] {
  const groups = new Map<string, BucketedLine[]>();
  const uaByKey = new Map<string, boolean>();
  let currentKey = "unknown";

  for (const line of lines) {
    const dateTime = extractLabDateTime(line.text);
    if (dateTime) {
      currentKey = dateTime;
      if (!groups.has(currentKey)) {
        groups.set(currentKey, []);
      }
      // 날짜 앵커 줄(=패널 헤더)은 그룹에 넣지 않지만, 요검사(UA) 패널이면 그 표식을 그룹에 기억해 둔다.
      if (isUrinalysisPanelHeaderText(line.text)) uaByKey.set(currentKey, true);
      continue;
    }
    const list = groups.get(currentKey) ?? [];
    list.push(line);
    groups.set(currentKey, list);
  }

  return [...groups.entries()].map(([dateTime, groupLines]) => ({
    dateTime,
    lines: groupLines,
    isUrinalysis: uaByKey.get(dateTime) === true,
  }));
}

function normalizeForContains(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function parseDateTimeLoose(text: string): Date | null {
  const m = text.match(
    /(20\d{2})[./-](\d{1,2})[./-](\d{1,2})\s+([0-2]?\d):([0-5]\d)(?::([0-5]\d))?/,
  );
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = m[6] ? Number(m[6]) : 0;
  const d = new Date(year, month, day, hour, minute, second);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeVitalValue(raw: string | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t || t === "-" || t === "—") return null;
  if (/^0(?:[.]0+)?$/.test(t)) return null;
  return t;
}

function normalizeDateOnly(dateText: string): string | null {
  const m = dateText.match(/^(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (!m) return null;
  return `${m[1]}-${String(Number(m[2])).padStart(2, "0")}-${String(Number(m[3])).padStart(2, "0")}`;
}

function isPhysicalExamHeaderLine(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim().toLowerCase();
  return (
    t === "name" ||
    t === "reference" ||
    t === "result" ||
    t === "unit" ||
    t === "result unit" ||
    t === "name reference result unit"
  );
}

function looksLikePhysicalExamReference(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/^<?\d+(?:[.,]\d+)?\s*[-~]\s*<?\d+(?:[.,]\d+)?$/.test(t)) return true;
  if (/^\d+\s*-\s*\d+$/.test(t)) return true;
  return false;
}

function splitPhysicalExamValueUnit(raw: string): { valueText: string; unit: string | null } {
  const t = raw.replace(/\s+/g, " ").trim();
  const m = t.match(/^(.+?)\s+([A-Za-z%/]+|kg|g|mg\/dL|도|회\/분|bpm)$/i);
  if (m) return { valueText: (m[1] ?? "").trim(), unit: (m[2] ?? "").trim() || null };
  return { valueText: t, unit: null };
}

function isLikelyPhysicalExamValueOnlyLine(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return true;
  if (looksLikePhysicalExamReference(t)) return true;
  if (/^(?:<|>)?\s*\d+(?:[.,]\d+)?(?:\s*(?:kg|g|mg\/dL|도|회\/분|bpm))?$/i.test(t)) return true;
  if (/^(?:nrf|pink|good|fair|poor|normal|abnormal)$/i.test(t)) return true;
  return false;
}

function parseEfriendsPhysicalExamItemsFromVitalsLines(vitalsLines: OrderedLine[]): ParsedPhysicalExamItem[] {
  const out: ParsedPhysicalExamItem[] = [];
  let currentDate: string | null = null;
  let collecting = false;
  let i = 0;
  while (i < vitalsLines.length) {
    const text = (vitalsLines[i]?.text ?? "").trim();
    if (!text) {
      i += 1;
      continue;
    }
    const dt = extractLabDateTime(text);
    if (dt) {
      currentDate = dt.slice(0, 10);
      i += 1;
      continue;
    }
    const dateOnly = normalizeDateOnly(text);
    if (dateOnly) {
      currentDate = dateOnly;
      i += 1;
      continue;
    }
    if (/^신체검사(?:\s|$|[:\-–—[(])/i.test(text)) {
      collecting = true;
      i += 1;
      continue;
    }
    if (!collecting) {
      i += 1;
      continue;
    }
    if (/cbc/i.test(text)) {
      collecting = false;
      i += 1;
      continue;
    }
    if (isPhysicalExamHeaderLine(text)) {
      i += 1;
      continue;
    }
    if (/^(laboratory|labratory)\s+date\s*:/i.test(text)) {
      collecting = false;
      i += 1;
      continue;
    }

    if (isLikelyPhysicalExamValueOnlyLine(text)) {
      i += 1;
      continue;
    }
    const itemName = text;
    const next = (vitalsLines[i + 1]?.text ?? "").trim();
    if (!next || isPhysicalExamHeaderLine(next)) {
      i += 1;
      continue;
    }
    const next2 = (vitalsLines[i + 2]?.text ?? "").trim();
    let referenceRange: string | null = null;
    let valueLine = next;
    let consumed = 2;
    if (looksLikePhysicalExamReference(next) && next2 && !isPhysicalExamHeaderLine(next2)) {
      referenceRange = next;
      valueLine = next2;
      consumed = 3;
    }
    const { valueText, unit } = splitPhysicalExamValueUnit(valueLine);
    if (!valueText) {
      i += 1;
      continue;
    }
    out.push({
      dateTime: currentDate ? `${currentDate}T00:00:00` : "unknown",
      itemName,
      referenceRange,
      valueText,
      unit,
      rawText: [itemName, referenceRange, `${valueText}${unit ? ` ${unit}` : ""}`].filter(Boolean).join(" "),
    });
    i += consumed;
  }
  return out.filter((x) => x.dateTime !== "unknown");
}

function mergeVitalsWithPhysicalExamItems(
  base: ParsedVitalRow[],
  items: ParsedPhysicalExamItem[],
): ParsedVitalRow[] {
  const merged = new Map(base.map((row) => [row.dateTime, { ...row }]));
  const byDate = new Map<string, ParsedPhysicalExamItem[]>();
  for (const item of items) {
    const list = byDate.get(item.dateTime) ?? [];
    list.push(item);
    byDate.set(item.dateTime, list);
  }

  const numeric = (v: string) => {
    const m = v.replace(",", ".").match(/[-+]?\d+(?:\.\d+)?/);
    return m?.[0] ?? null;
  };

  for (const [dateTime, list] of byDate) {
    const row =
      merged.get(dateTime) ??
      ({
        dateTime,
        weight: null,
        temperature: null,
        respiratoryRate: null,
        heartRate: null,
        bpSystolic: null,
        bpDiastolic: null,
        rawText: "",
      } satisfies ParsedVitalRow);

    for (const it of list) {
      const name = it.itemName.replace(/\s+/g, "");
      if (!row.weight && /체중/.test(name)) row.weight = numeric(it.valueText) ?? it.valueText;
      if (!row.temperature && /체온/.test(name)) row.temperature = numeric(it.valueText) ?? it.valueText;
      if (!row.heartRate && /(pr|심박)/i.test(it.itemName)) row.heartRate = numeric(it.valueText) ?? it.valueText;
      if (!row.respiratoryRate && /(rr|호흡)/i.test(it.itemName)) row.respiratoryRate = numeric(it.valueText) ?? it.valueText;
      if (!row.rawText.includes(it.rawText)) {
        row.rawText = row.rawText ? `${row.rawText} | ${it.rawText}` : it.rawText;
      }
    }
    merged.set(dateTime, row);
  }

  return [...merged.values()].sort((a, b) => a.dateTime.localeCompare(b.dateTime));
}

type WoorienVitalCol = "date" | "time" | "weight" | "temperature" | "bp" | "heartRate" | "sign";

/** 우리엔 Vital 헤더 토큰 분류. 단위 괄호(`(Kg)` 등)는 'unit', 미상은 null. */
function classifyWoorienVitalToken(token: string): WoorienVitalCol | "unit" | null {
  const t = token.trim();
  if (!t) return null;
  if (/^\(.*\)$/.test(t)) return "unit";
  if (t === "날짜") return "date";
  if (t === "시간") return "time";
  if (/sign/i.test(t)) return "sign";
  if (/BW/i.test(t)) return "weight";
  if (/BT/i.test(t)) return "temperature";
  if (/BP/i.test(t)) return "bp";
  if (/HR/i.test(t)) return "heartRate";
  return null;
}

/** 줄의 모든 토큰이 헤더 라벨/단위면 헤더 줄(레이아웃 A: 한 줄, B: 한 칸씩 분리 모두 대응). */
function isWoorienVitalHeaderLine(text: string): boolean {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  return tokens.every((tok) => classifyWoorienVitalToken(tok) !== null);
}

/**
 * 우리엔PMS Vital Check 표. LLM 추출이 표를 한 줄로 합치기도(레이아웃 A) 셀마다 한 줄씩 쪼개기도(B) 한다.
 * → 헤더 라벨 줄들의 **연속 구간**에서 컬럼 순서(날짜·시간·BW·BT·BP·HR·Sign 등)를 읽고,
 *   그 뒤 데이터 토큰을 한 줄로 펼쳐 날짜 토큰마다 한 행씩 컬럼 순서대로 매핑한다.
 * 매핑: BW→체중, BT→체온, BP→혈압(수축), HR→심박수. (호흡수 칼럼 없음, Sign 무시)
 * placeholder 0 은 normalizeVitalValue 가 null 처리. 헤더 위 그래프 텍스트(6.9-, 날짜 등)는 자연히 제외됨.
 */
function parseWoorienVitalsFromLines(lines: OrderedLine[]): ParsedVitalRow[] {
  const values: ParsedVitalRow[] = [];

  // 1) 헤더 라벨 줄의 연속 구간 중 BW/BT/BP/HR 가 2개 이상 들어간 run 을 찾는다.
  let runStart = -1;
  let runEnd = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (!isWoorienVitalHeaderLine(lines[i].text)) continue;
    let j = i;
    const cols = new Set<WoorienVitalCol>();
    while (j < lines.length && isWoorienVitalHeaderLine(lines[j].text)) {
      for (const tok of lines[j].text.trim().split(/\s+/)) {
        const cls = classifyWoorienVitalToken(tok);
        if (cls && cls !== "unit") cols.add(cls);
      }
      j += 1;
    }
    const vitalCount =
      (cols.has("weight") ? 1 : 0) +
      (cols.has("temperature") ? 1 : 0) +
      (cols.has("bp") ? 1 : 0) +
      (cols.has("heartRate") ? 1 : 0);
    if (vitalCount >= 2) {
      runStart = i;
      runEnd = j;
      break;
    }
    i = j; // 이 run 은 헤더가 아니므로 건너뜀
  }
  if (runStart < 0) return values;

  // 2) 컬럼 순서 추출
  const columns: WoorienVitalCol[] = [];
  for (let i = runStart; i < runEnd; i += 1) {
    for (const tok of lines[i].text.trim().split(/\s+/)) {
      const cls = classifyWoorienVitalToken(tok);
      if (cls && cls !== "unit") columns.push(cls);
    }
  }
  if (columns.length === 0) return values;
  const dateColPos = columns.indexOf("date");

  // 3) 데이터 토큰을 펼침(stop 키워드 전까지)
  const stopPattern = /(vaccination|접종|plan|subjective|objective|진단\s*검사|검체\s*검사|chart\s*image)/i;
  const dataTokens: string[] = [];
  for (let i = runEnd; i < lines.length; i += 1) {
    const text = lines[i].text.trim();
    if (!text) continue;
    if (stopPattern.test(text)) break;
    for (const tok of text.split(/\s+/)) if (tok) dataTokens.push(tok);
  }

  // 4) 날짜 토큰마다 한 행 시작, 컬럼 순서대로 매핑
  const isDateToken = (t: string) => /^20\d{2}[./-]\d{1,2}[./-]\d{1,2}$/.test(t);
  const flushRow = (buf: string[]) => {
    if (buf.length === 0) return;
    const get = (col: WoorienVitalCol) => {
      const pos = columns.indexOf(col);
      return pos >= 0 ? buf[pos] : undefined;
    };
    const dateVal = get("date") ?? "";
    const timeVal = get("time") ?? "";
    const dateTime = `${dateVal} ${timeVal}`.trim();
    if (!dateTime) return;
    values.push({
      dateTime,
      weight: normalizeVitalValue(get("weight")),
      temperature: normalizeVitalValue(get("temperature")),
      respiratoryRate: null,
      heartRate: normalizeVitalValue(get("heartRate")),
      bpSystolic: normalizeVitalValue(get("bp")),
      bpDiastolic: null,
      rawText: buf.join(" "),
    });
  };

  let buffer: string[] = [];
  for (const tok of dataTokens) {
    if (isDateToken(tok) && (dateColPos <= 0 ? buffer.length > 0 : buffer.length >= columns.length)) {
      flushRow(buffer);
      buffer = [];
    }
    buffer.push(tok);
  }
  flushRow(buffer);

  return values;
}

function parseVitalsFromLines(lines: OrderedLine[], chartKind: ChartKind): ParsedVitalRow[] {
  if (chartKind === "woorien_pms") return parseWoorienVitalsFromLines(lines);
  const values: ParsedVitalRow[] = [];
  const start = lines.findIndex((line) =>
    /일시/.test(line.text) &&
    /체중/.test(line.text) &&
    /체온/.test(line.text) &&
    /호흡수/.test(line.text) &&
    /심박수/.test(line.text) &&
    /혈압\(수축\)/.test(line.text) &&
    /혈압\(이완\)/.test(line.text),
  );
  if (start < 0) return values;

  const vitalsStopPattern =
    chartKind === "intovet"
      ? /(진단\s*검사\s*결과|진단\s*결과\s*추이|plan|subjective|objective|vaccination|lab examination)/i
      : /(진단\s*검사|진단\s*검사\s*결과|진단\s*결과\s*추이|접종\s*내역|접종|plan|subjective|objective|vaccination|lab examination|임상\s*병리|검체\s*검사)/i;

  for (let i = start + 1; i < lines.length; i += 1) {
    const text = lines[i].text.trim();
    if (!text) continue;
    if (/^--\s*\d+\s+of\s+\d+\s*--$/i.test(text)) continue;
    if (vitalsStopPattern.test(text)) {
      break;
    }

    const m = text.match(
      /^(20\d{2}[./-]\d{1,2}[./-]\d{1,2}\s+[0-2]?\d:[0-5]\d)\s+(.+)$/,
    );
    if (!m) continue;

    const dateTime = m[1].trim();
    const rest = m[2].trim();
    const parts = rest.split(/\s+/).filter(Boolean);
    if (parts.length < 6) continue;

    values.push({
      dateTime,
      weight: normalizeVitalValue(parts[0]),
      temperature: normalizeVitalValue(parts[1]),
      respiratoryRate: normalizeVitalValue(parts[2]),
      heartRate: normalizeVitalValue(parts[3]),
      bpSystolic: normalizeVitalValue(parts[4]),
      bpDiastolic: normalizeVitalValue(parts[5]),
      rawText: text,
    });
  }

  return values;
}

function sameYmd(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function findNearestChartRowId(
  vitalDateTime: string,
  chartRows: Array<{ id: string; date_time: string }>,
  maxMinutes = 20,
) {
  const target = parseDateTimeLoose(vitalDateTime);
  if (!target) return null;

  let best: { id: string; diffMin: number } | null = null;
  for (const row of chartRows) {
    const d = parseDateTimeLoose(row.date_time);
    if (!d) continue;
    if (!sameYmd(target, d)) continue;
    const diffMin = Math.abs(target.getTime() - d.getTime()) / 60000;
    if (diffMin > maxMinutes) continue;
    if (!best || diffMin < best.diffMin) {
      best = { id: row.id, diffMin };
    }
  }
  return best?.id ?? null;
}

function inferFlagFromText(text: string): "low" | "high" | "normal" | "unknown" {
  const normalized = text.toLowerCase();
  if (/\b(low|l)\b/.test(normalized)) return "low";
  if (/\b(high|h)\b/.test(normalized)) return "high";
  if (/\b(normal|negative|nonreactive)\b/.test(normalized)) return "normal";
  if (/\b(positive|abnormal|reactive)\b/.test(normalized)) return "high";
  return "unknown";
}

const LAB_ROW_END_FLAG = /^(NORMAL|LOW|HIGH|UNDER)$/i;

function isCatalystValueToken(token: string) {
  const t = token.trim();
  if (/^[-+]?\d+(?:[.,]\d+)?(?:[!A-Za-z]+)?$/.test(t)) return true;
  if (/^<\s*\d+(?:[.,]\d+)?(?:[!A-Za-z]+)?$/.test(t)) return true;
  return false;
}

/** ALB/GLOB, BUN/CREA, Na/K 등 단위·Min/Max 없이 비율만 오는 항목명. */
function isRatioStyleAnalyteName(name: string) {
  const t = name.trim();
  if (!t.includes("/") || t.length > 56) return false;
  return /^[A-Za-z][A-Za-z0-9.]*(?:\/[A-Za-z][A-Za-z0-9.]*)+$/.test(t);
}

const LAB_VERTICAL_VALUE_FLAG = /^([-+<]?\s*\d+(?:[.,]\d+)?(?:[!A-Za-z]+)?)(?:\s+(NORMAL|LOW|HIGH|UNDER))?$/i;

/**
 * IntoVet / Catalyst 계열: 한 줄에 "검사명 단위 min max 결과 [NORMAL|HIGH|LOW]".
 * 기존 numericRowRegex는 단위에 µ, 숫자(10x3/μL) 등이 들어가면 실패해서 대부분의 행이 누락됨.
 */
function parseCatalystSingleLineRow(cleaned: string, page: number): LabItem | null {
  const lower = cleaned.toLowerCase();
  if (/^performed by\b/i.test(lower)) return null;
  if (/^pacs\b/i.test(lower)) return null;
  if (/^image date:/i.test(lower)) return null;
  if (/^name\s+unit\s+min\s+max\s+result$/i.test(cleaned.trim())) return null;

  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;

  {
    let end = tokens.length;
    let flagSuffix = "";
    if (LAB_ROW_END_FLAG.test(tokens[end - 1] ?? "")) {
      flagSuffix = tokens[end - 1];
      end -= 1;
    }
    const core = tokens.slice(0, end);
    if (core.length === 2 && isRatioStyleAnalyteName(core[0]) && isCatalystValueToken(core[1])) {
      const valueText = core[1].replace(/\s+/g, "");
      const valueNum = Number.parseFloat(valueText.replace(/^</, "").replace(",", "."));
      return {
        page,
        rowY: 0,
        itemName: core[0].trim(),
        value: Number.isFinite(valueNum) ? valueNum : null,
        valueText,
        unit: null,
        referenceRange: null,
        flag: inferFlagFromText(flagSuffix || valueText),
        rawRow: cleaned,
      };
    }
  }

  if (tokens.length < 4) return null;

  let end = tokens.length;
  let flagSuffix = "";
  if (LAB_ROW_END_FLAG.test(tokens[end - 1] ?? "")) {
    flagSuffix = tokens[end - 1];
    end -= 1;
  }

  if (end < 4) return null;
  const resultTok = tokens[end - 1] ?? "";
  const maxTok = tokens[end - 2] ?? "";
  const minTok = tokens[end - 3] ?? "";

  if (!isCatalystValueToken(resultTok) || !isCatalystValueToken(maxTok) || !isCatalystValueToken(minTok)) {
    return null;
  }

  const rest = tokens.slice(0, end - 3);

  if (rest.length >= 2) {
    if (end < 5) return null;
    const unit = rest[rest.length - 1] ?? "";
    const itemName = rest.slice(0, -1).join(" ").trim();
    if (!itemName || !unit) return null;

    const valueText = resultTok.replace(/\s+/g, "");
    const valueNum = Number.parseFloat(valueText.replace(/^</, "").replace(",", "."));

    return {
      page,
      rowY: 0,
      itemName,
      value: Number.isFinite(valueNum) ? valueNum : null,
      valueText,
      unit,
      referenceRange: `${minTok}-${maxTok}`,
      flag: inferFlagFromText(flagSuffix || valueText),
      rawRow: cleaned,
    };
  }

  if (rest.length === 1) {
    const itemName = (rest[0] ?? "").trim();
    if (!itemName.includes("/")) return null;

    const valueText = resultTok.replace(/\s+/g, "");
    const valueNum = Number.parseFloat(valueText.replace(/^</, "").replace(",", "."));

    return {
      page,
      rowY: 0,
      itemName,
      value: Number.isFinite(valueNum) ? valueNum : null,
      valueText,
      unit: null,
      referenceRange: `${minTok}-${maxTok}`,
      flag: inferFlagFromText(flagSuffix || valueText),
      rawRow: cleaned,
    };
  }

  return null;
}

/** 세로 Lab 표: 단위 줄 (µg/dL, 10x3/μL 등). 숫자만 있는 줄은 단위가 아님. */
function looksLikeVerticalLabUnitLine(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  if (isCatalystValueToken(t)) return false;
  if (LAB_ROW_END_FLAG.test(t)) return false;
  if (/^w:\d+\s+l:\d+$/i.test(t)) return false;
  return true;
}

function hasVerticalFiveColumnTail(l3: string, l4: string, l5: string): boolean {
  return (
    Boolean(l3 && l4 && l5) &&
    isCatalystValueToken(l3) &&
    isCatalystValueToken(l4) &&
    /[-+<]?\s*\d+(?:[.,]\d+)?/.test(l5)
  );
}

/**
 * IntoVet의 `Name Unit Min Max Result` 블록에서 가로 1줄 검사행을
 * 세로 1토큰 행들로 펼친다.
 *
 * 예)
 * - `Na mmol/L 141 152 148 NORMAL` -> `Na`,`mmol/L`,`141`,`152`,`148 NORMAL`
 * - `ALB/GLOB 0.7 1.9 2 HIGH` -> `ALB/GLOB`,`0.7`,`1.9`,`2`,`HIGH`
 * - `PDW-CV % 16.7` -> `PDW-CV`,`%`,`16.7`
 */
function normalizeIntoVetHeaderBodyLines(body: string[]): string[] {
  const out: string[] = [];
  for (const raw of body) {
    const line = raw.trim();
    if (!line) continue;

    // Keep obvious metadata/noise lines as-is.
    if (isLabVerticalNoiseLine(line)) {
      out.push(line);
      continue;
    }

    const tokens = line.split(/\s+/).filter(Boolean);
    if (tokens.length < 2) {
      out.push(line);
      continue;
    }

    let end = tokens.length;
    let trailingFlag: string | null = null;
    if (LAB_ROW_END_FLAG.test(tokens[end - 1] ?? "")) {
      trailingFlag = tokens[end - 1] ?? null;
      end -= 1;
    }
    if (end <= 1) {
      out.push(line);
      continue;
    }

    const tokenAt = (idx: number) => tokens[idx] ?? "";

    // item + unit + min + max + value [+ flag]
    if (
      end >= 5 &&
      isCatalystValueToken(tokenAt(end - 1)) &&
      isCatalystValueToken(tokenAt(end - 2)) &&
      isCatalystValueToken(tokenAt(end - 3))
    ) {
      const unit = tokenAt(end - 4);
      const itemName = tokens.slice(0, end - 4).join(" ").trim();
      if (itemName && looksLikeVerticalLabUnitLine(unit)) {
        out.push(itemName, unit, tokenAt(end - 3), tokenAt(end - 2), tokenAt(end - 1));
        if (trailingFlag) out.push(trailingFlag);
        continue;
      }
    }

    // ratio item + min + max + value [+ flag] (no unit)
    if (
      end >= 4 &&
      isCatalystValueToken(tokenAt(end - 1)) &&
      isCatalystValueToken(tokenAt(end - 2)) &&
      isCatalystValueToken(tokenAt(end - 3))
    ) {
      const itemName = tokens.slice(0, end - 3).join(" ").trim();
      if (isRatioStyleAnalyteName(itemName)) {
        out.push(itemName, tokenAt(end - 3), tokenAt(end - 2), tokenAt(end - 1));
        if (trailingFlag) out.push(trailingFlag);
        continue;
      }
    }

    // item + unit + value
    if (end >= 3 && isCatalystValueToken(tokenAt(end - 1))) {
      const unit = tokenAt(end - 2);
      const itemName = tokens.slice(0, end - 2).join(" ").trim();
      if (itemName && looksLikeVerticalLabUnitLine(unit)) {
        out.push(itemName, unit, tokenAt(end - 1));
        if (trailingFlag) out.push(trailingFlag);
        continue;
      }
    }

    // item + value
    if (end >= 2 && isCatalystValueToken(tokenAt(end - 1))) {
      const itemName = tokens.slice(0, end - 1).join(" ").trim();
      if (itemName) {
        out.push(itemName, tokenAt(end - 1));
        if (trailingFlag) out.push(trailingFlag);
        continue;
      }
    }

    out.push(line);
  }

  // Safety fallback: if normalization collapsed too much, keep original body.
  return out.length < Math.floor(body.length * 0.6) ? body : out;
}

/** 세로 표 본문 안의 초음파/PACS/메타 줄 — 검사 행이 아님. */
function isLabVerticalNoiseLine(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  if (/^performed by\b/i.test(t)) return true;
  if (/^pacs\b/i.test(t)) return true;
  if (/^image date:/i.test(t)) return true;
  if (/^ima\s+/i.test(t)) return true;
  if (/^w:\d+\s+l:\d+/i.test(t)) return true;
  if (/^dodam\b/i.test(t)) return true;
  if (/^vivid\b/i.test(t)) return true;
  if (/^vr$/i.test(t)) return true;
  if (/^fu\s+m?$/i.test(t) || /^fu\s*m$/i.test(t)) return true;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return true;
  if (/^\d{1,2}:\d{2}(:\d{2})?(\s*(오전|오후))?$/i.test(t)) return true;
  if (/^\d+\s*,\s*\d{6,8}$/.test(t)) return true;
  if (/^[.\d]+\s*mm$/i.test(t)) return true;
  if (/\$?1\.2\.40\.0\.13\./i.test(t)) return true;
  if (/^m?m:\s*[\d.]+\s*mm$/i.test(t.replace(/\s+/g, " "))) return true;
  if ((/^(rt\.|lt\.)/i.test(t) || /(adrenal|kidney|pancreas|spleen|gland)/i.test(t)) && !/\d/.test(t)) {
    return true;
  }
  if (/^result part title$/i.test(t)) return true;
  if (/^lab examination$/i.test(t)) return true;
  if (/^\d+\.\d+\.\d+$/.test(t)) return true;
  if (/^[wv]:\d+/i.test(t)) return true;
  return false;
}

/** 우리엔 검사 표 헤더 라벨 줄(검사명/결과값 단위/MIN/MAX/Description) */
const WOORIEN_LAB_HEADER_LINE = /^(?:검사명|결과값\s*단위|결과값|단위|min|max|description)$/i;
/** 우리엔 검사 항목 종료 = Description(플래그) 줄 */
const WOORIEN_LAB_FLAG_LINE = /^(?:high|low|normal)$/i;

/**
 * 우리엔PMS 검사 표 파싱. 두 가지 버킷 형태를 모두 지원한다.
 *  (A) 가로형 — 한 줄에 "검사명 값 [단위] [MIN] [MAX]" 가 다 들어옴.
 *       예) "WBC 11.44 10^9/L 6 17", "Na/K 32.7 29.9 39.2", "B/C 31", "AMY 1,782 U/L 500 1,400"
 *  (B) 세로형 — 토큰이 줄마다 하나(검사명 / "값 단위" / MIN / MAX / [Description 플래그]).
 * 매핑: 검사명→itemName, 값(+단위)→value/valueText·unit, MIN·MAX→referenceRange.
 * 날짜/시각("| 2026-… 오전 …")·Sign·헤더·기기명 줄은 무시.
 */
function parseWoorienLabItemsFromGroupLines(lines: BucketedLine[]): LabItem[] {
  const items: LabItem[] = [];
  // 순수 숫자 토큰(천단위 콤마·소수점 허용, % 없음). MIN/MAX 판정용.
  const isPureNum = (s: string | undefined) => !!s && /^[<>]?[-+]?[\d,]+(?:\.\d+)?$/.test(String(s).trim());
  // 값 토큰: 부호·<> 후 숫자/콤마로 시작(뒤에 % 등 붙어도 됨).
  const looksValue = (s: string) => /^[<>]?[-+]?[\d,]/.test(s.trim());
  const looksName = (s: string) => /^[A-Za-z]/.test(s.trim());

  const skip = (t: string) =>
    /^[-–—]+$/.test(t) || // 단독 대시 줄 = 플래그/구분 칸(정상 표시 등) — 검사행 아님
    /^\|/.test(t) || // "| 2026-05-07 오전 11:38:14 Vcheck H6" 날짜/시각·기기명 줄
    /^20\d{2}[./-]\d{1,2}[./-]\d{1,2}/.test(t) || // 날짜
    (/(오전|오후)/.test(t) && /\d{1,2}:\d{2}/.test(t)) || // 시각 줄
    /^sign\s*[:：]/i.test(t) || // Sign : 담당자
    /[(（][^)）]*[가-힣]/.test(t) || // 기기/패널 헤더(검체종류 한글 괄호) — 예: "NX 600 (혈청)", "PT10V(혈청)". 실제 검사항목엔 한글 괄호 없음.
    WOORIEN_LAB_HEADER_LINE.test(t);

  const pushItem = (
    name: string,
    valueRaw: string,
    unitFromTokens: string,
    minTok: string | undefined,
    maxTok: string | undefined,
    page: number,
    raw: string,
    flag: LabItem["flag"],
  ) => {
    const vm = String(valueRaw).match(/^([<>]?\s*[-+]?[\d,]+(?:\.\d+)?)\s*(.*)$/);
    const valueText = (vm ? vm[1]! : valueRaw).replace(/\s+/g, "");
    const unit = (unitFromTokens || (vm ? (vm[2] ?? "").trim() : "")).trim();
    const referenceRange =
      isPureNum(minTok) && isPureNum(maxTok)
        ? `${String(minTok).trim()} - ${String(maxTok).trim()}`
        : isPureNum(minTok)
          ? String(minTok).trim()
          : null;
    // 콤마는 천 단위 구분자(예 "1,782" → 1782), 마침표는 소수점.
    const valueNum = Number.parseFloat(valueText.replace(/[<>]/g, "").replace(/,/g, ""));
    // 우리엔 가로형은 차트의 화살표를 무시하므로 flag=unknown 으로 들어온다 → 값↔참고범위로 자동 계산.
    //  (Description 세로형처럼 이미 high/low/normal 로 정해진 경우는 그대로 둔다)
    const finalFlag = flag === "unknown" ? computeLabFlag(valueText, referenceRange) : flag;
    items.push({
      page,
      rowY: 0,
      itemName: name,
      value: Number.isFinite(valueNum) ? valueNum : null,
      valueText,
      unit: unit || null,
      referenceRange,
      flag: finalFlag,
      rawRow: raw,
    });
  };

  // 세로형(토큰이 줄마다 하나) 폴백용 버퍼.
  let vbuf: Array<{ text: string; page: number }> = [];
  const flushVertical = (flag: LabItem["flag"]) => {
    if (vbuf.length >= 2 && looksName(vbuf[0]!.text)) {
      pushItem(
        vbuf[0]!.text,
        vbuf[1]!.text,
        "",
        vbuf[2]?.text.trim(),
        vbuf[3]?.text.trim(),
        vbuf[0]!.page,
        vbuf.map((b) => b.text).join(" ") + (flag !== "unknown" ? ` ${flag}` : ""),
        flag,
      );
    }
    vbuf = [];
  };

  for (const line of lines) {
    // 플래그 표시 세모/화살표(▲▼△▽↑↓ 등)는 값·단위·범위와 무관 → 파싱 전에 제거.
    //  flag 는 아래 pushItem 에서 값↔참고범위로 자동 계산하므로 정보 손실 없음.
    const t = (line.text ?? "")
      .replace(/[▲△▴▵▼▽▾▿◤◥◣◢►◄▶◀↑↓⬆⬇⇧⇩]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!t || skip(t)) continue;

    const toks = t.split(/\s+/).filter(Boolean);

    // (A) 가로형: "검사명 값 [단위] [MIN] [MAX]" 한 줄에 다.
    if (toks.length >= 2 && looksName(toks[0]!) && looksValue(toks[1]!)) {
      flushVertical("unknown"); // 직전 세로형 누적이 있으면 마무리
      const name = toks[0]!;
      const valueRaw = toks[1]!;
      const rest = toks.slice(2);
      let unit = "";
      // 값 다음의 비숫자 토큰(들) = 단위. 예: "10^9/L", "g/dL", "mmol/L", "%"
      //  단, 단독 대시("-")는 단위·범위 사이의 플래그/구분 칸이므로 단위에 넣지 않고 건너뛴다.
      //  (우리엔 포맷: "WBC 11.1 10x9/L - 6 17" 의 "-" 가 unit 으로 새어들던 문제)
      while (rest.length > 0 && !isPureNum(rest[0]!)) {
        const u = rest.shift()!;
        if (/^[-–—]+$/.test(u)) continue;
        unit = unit ? `${unit} ${u}` : u;
      }
      // 남은 숫자 토큰 = MIN, MAX
      pushItem(name, valueRaw, unit, rest[0], rest[1], line.page, t, "unknown");
      continue;
    }

    // (B) 세로형 폴백.
    if (WOORIEN_LAB_FLAG_LINE.test(t)) {
      flushVertical(t.toLowerCase() as LabItem["flag"]); // Description 플래그 = 항목 종료
      continue;
    }
    if (looksName(t) && !looksValue(t)) {
      flushVertical("unknown"); // 새 검사명 = 직전 항목 종료
      vbuf = [{ text: t, page: line.page }];
      continue;
    }
    if (vbuf.length > 0) vbuf.push({ text: t, page: line.page });
  }
  flushVertical("unknown"); // 마지막 항목

  return items;
}

function parseLabItemsFromGroupLines(lines: BucketedLine[], chartKind: ChartKind = "intovet", opts?: { isUrinalysis?: boolean }): LabItem[] {
  if (chartKind === "woorien_pms") {
    return parseWoorienLabItemsFromGroupLines(lines);
  }
  if (chartKind === "plusvet") {
    const pv = parsePlusVetLabBucketLines(lines, { forceUrinalysis: opts?.isUrinalysis === true });
    const uniquePv = new Map<string, LabItem>();
    for (const item of pv) {
      const key = `${item.itemName.toUpperCase()}|${item.valueText.toUpperCase()}|${item.page}`;
      if (!uniquePv.has(key)) uniquePv.set(key, item);
    }
    return [...uniquePv.values()];
  }

  if (chartKind === "efriends") {
    return parseEfriendsLabItemsFromBucketLines(lines);
  }

  const items: LabItem[] = [];
  const qualitativeToken = "(Normal|Negative|Positive|Abnormal|Reactive|Nonreactive|Trace)";
  const numericRowRegex =
    /^(.+?)\s+([A-Za-z%/]+)\s+([-+]?\d+(?:[.,]\d+)?)\s+([-+]?\d+(?:[.,]\d+)?)\s+([-+<]?\s*\d+(?:[.,]\d+)?(?:[!A-Za-z]+)?)(?:\s+(NORMAL|LOW|HIGH|UNDER))?$/i;
  const qualitativeRowRegex =
    new RegExp(`^(.+?)\\s+${qualitativeToken}\\s+${qualitativeToken}\\s+${qualitativeToken}$`, "i");
  const qualitativeTokenRegex = /^(Normal|Negative|Positive|Abnormal|Reactive|Nonreactive|Trace)$/i;

  const preferNumericFirst = chartKind !== "intovet";

  for (const line of lines) {
    const text = line.text.trim().replace(/\s+/g, " ");
    if (!text) continue;

    // Some lines come as: "Name Unit Min Max Result / CRP mg/L 0.1 1 0.9 NORMAL".
    // IMPORTANT: split only on spaced slash (" / "), not raw "/" because
    // valid units like mg/dL, 10x9/L would be broken otherwise.
    const segments = text
      .split(/\s\/\s/)
      .map((segment) => segment.trim())
      .filter(Boolean);

    for (const segment of segments.length > 0 ? segments : [text]) {
      const cleaned = segment
        .replace(/^name\s+unit\s+min\s+max\s+result\s*/i, "")
        .replace(/^test\s+name\s+unit\s+min\s+max\s+result\s*/i, "")
        .trim();
      if (!cleaned) continue;

      const pushNumericIfMatch = () => {
        const numeric = cleaned.match(numericRowRegex);
        if (!numeric) return false;
        const itemName = numeric[1];
        const unit = numeric[2];
        const min = numeric[3];
        const max = numeric[4];
        const valueText = numeric[5];
        const flagText = numeric[6] ?? "";
        items.push({
          page: line.page,
          rowY: 0,
          itemName,
          value: Number.parseFloat(valueText.replace(",", ".")),
          valueText,
          unit,
          referenceRange: `${min}-${max}`,
          flag: inferFlagFromText(flagText || valueText),
          rawRow: cleaned,
        });
        return true;
      };

      if (preferNumericFirst && pushNumericIfMatch()) continue;

      const catalystItem = parseCatalystSingleLineRow(cleaned, line.page);
      if (catalystItem) {
        items.push(catalystItem);
        continue;
      }

      if (!preferNumericFirst && pushNumericIfMatch()) continue;

      const qualitative = cleaned.match(qualitativeRowRegex);
      if (qualitative) {
        const itemName = qualitative[1].trim();
        const valueText = qualitative[4].trim();
        items.push({
          page: line.page,
          rowY: 0,
          itemName,
          value: null,
          valueText,
          unit: null,
          referenceRange: `${qualitative[2]} ${qualitative[3]}`,
          flag: inferFlagFromText(valueText),
          rawRow: cleaned,
        });
        continue;
      }
    }
  }

  const normalized = lines.map((line) => line.text.trim()).filter(Boolean);
  const headerIndex = normalized.findIndex((line, index) => {
    return (
      /^name$/i.test(line) &&
      /^unit$/i.test(normalized[index + 1] ?? "") &&
      /^min$/i.test(normalized[index + 2] ?? "") &&
      /^max$/i.test(normalized[index + 3] ?? "") &&
      /^result$/i.test(normalized[index + 4] ?? "")
    );
  });
  if (headerIndex >= 0) {
    const bodyRaw = normalized.slice(headerIndex + 5);
    const body =
      chartKind === "intovet" ? normalizeIntoVetHeaderBodyLines(bodyRaw) : bodyRaw;
    let cursor = 0;
    while (cursor < body.length) {
      const itemName = body[cursor]?.trim() ?? "";
      if (!itemName) break;

      if (isLabVerticalNoiseLine(itemName)) {
        cursor += 1;
        continue;
      }

      const l2 = body[cursor + 1]?.trim() ?? "";
      const l3 = body[cursor + 2]?.trim() ?? "";
      const l4 = body[cursor + 3]?.trim() ?? "";
      const l5 = body[cursor + 4]?.trim() ?? "";
      const l6 = body[cursor + 5]?.trim() ?? "";

      // Vertical qualitative pattern: item + Normal + Normal + Negative
      if (
        l2 &&
        l3 &&
        l4 &&
        qualitativeTokenRegex.test(l2) &&
        qualitativeTokenRegex.test(l3) &&
        qualitativeTokenRegex.test(l4)
      ) {
        const src = lines.find((line) => line.text.trim() === itemName);
        items.push({
          page: src?.page ?? 1,
          rowY: 0,
          itemName,
          value: null,
          valueText: l4,
          unit: null,
          referenceRange: `${l2} ${l3}`,
          flag: inferFlagFromText(l4),
          rawRow: `${itemName} ${l2} ${l3} ${l4}`,
        });
        cursor += 4;
        continue;
      }

      // Variant where the last two qualitative cells are packed:
      // item
      // Normal
      // Normal Negative
      if (
        l2 &&
        l3 &&
        qualitativeTokenRegex.test(l2) &&
        /^(Normal|Negative|Positive|Abnormal|Reactive|Nonreactive|Trace)\s+(Normal|Negative|Positive|Abnormal|Reactive|Nonreactive|Trace)$/i.test(
          l3,
        )
      ) {
        const packed = l3.match(
          /^(Normal|Negative|Positive|Abnormal|Reactive|Nonreactive|Trace)\s+(Normal|Negative|Positive|Abnormal|Reactive|Nonreactive|Trace)$/i,
        );
        const ref2 = packed?.[1] ?? "";
        const result = packed?.[2] ?? "";
        const src = lines.find((line) => line.text.trim() === itemName);
        items.push({
          page: src?.page ?? 1,
          rowY: 0,
          itemName,
          value: null,
          valueText: result,
          unit: null,
          referenceRange: `${l2} ${ref2}`.trim(),
          flag: inferFlagFromText(result),
          rawRow: `${itemName} ${l2} ${ref2} ${result}`,
        });
        cursor += 3;
        continue;
      }

      // Vertical quantitative pattern: item + unit + min + max + result (한 줄씩 쌓인 Catalyst/ProCyte)
      // result may include flag, e.g. "0.9 NORMAL", "< 0.1 UNDER"
      // 단위 줄에 µ, μ, 10x3/μL 등이 들어가므로 ASCII-only 검사는 쓰지 않음.
      // 6-line variant: item + unit + min + max + result + FLAG (e.g. WBC-LYM% % 12 30 36.5 HIGH)
      if (
        l2 &&
        l3 &&
        l4 &&
        l5 &&
        l6 &&
        looksLikeVerticalLabUnitLine(l2) &&
        /^[-+]?\d+(?:[.,]\d+)?$/.test(l3) &&
        /^[-+]?\d+(?:[.,]\d+)?$/.test(l4) &&
        /[-+<]?\s*\d+(?:[.,]\d+)?/.test(l5) &&
        LAB_ROW_END_FLAG.test(l6)
      ) {
        const resultMatch = l5.match(/([-+<]?\s*\d+(?:[.,]\d+)?)/);
        const valueText = resultMatch ? resultMatch[1].replace(/\s+/g, "") : l5;
        const src = lines.find((line) => line.text.trim() === itemName);
        items.push({
          page: src?.page ?? 1,
          rowY: 0,
          itemName,
          value: Number.parseFloat(valueText.replace("<", "").replace(",", ".")),
          valueText,
          unit: l2,
          referenceRange: `${l3}-${l4}`,
          flag: inferFlagFromText(l6),
          rawRow: `${itemName} ${l2} ${l3} ${l4} ${l5} ${l6}`,
        });
        cursor += 6;
        continue;
      }

      if (
        l2 &&
        l3 &&
        l4 &&
        l5 &&
        looksLikeVerticalLabUnitLine(l2) &&
        /^[-+]?\d+(?:[.,]\d+)?$/.test(l3) &&
        /^[-+]?\d+(?:[.,]\d+)?$/.test(l4) &&
        /[-+<]?\s*\d+(?:[.,]\d+)?/.test(l5)
      ) {
        const resultMatch = l5.match(/([-+<]?\s*\d+(?:[.,]\d+)?)/);
        const valueText = resultMatch ? resultMatch[1].replace(/\s+/g, "") : l5;
        const src = lines.find((line) => line.text.trim() === itemName);
        items.push({
          page: src?.page ?? 1,
          rowY: 0,
          itemName,
          value: Number.parseFloat(valueText.replace("<", "").replace(",", ".")),
          valueText,
          unit: l2,
          referenceRange: `${l3}-${l4}`,
          flag: inferFlagFromText(l5),
          rawRow: `${itemName} ${l2} ${l3} ${l4} ${l5}`,
        });
        cursor += 5;
        continue;
      }

      // Vertical ratio: 검사명 + min + max + result/FLAG (단위 열 없음. BUN/CREA, Na/K 등)
      // 5-line variant: item + min + max + result + FLAG (e.g. ALB/GLOB 0.7 1.9 2 HIGH)
      if (
        l2 &&
        l3 &&
        l4 &&
        l5 &&
        itemName.includes("/") &&
        isCatalystValueToken(l2) &&
        isCatalystValueToken(l3) &&
        /^[-+<]?\s*\d+(?:[.,]\d+)?$/.test(l4) &&
        LAB_ROW_END_FLAG.test(l5)
      ) {
        const valueText = l4.replace(/\s+/g, "");
        const src = lines.find((line) => line.text.trim() === itemName);
        items.push({
          page: src?.page ?? 1,
          rowY: 0,
          itemName,
          value: Number.parseFloat(valueText.replace("<", "").replace(",", ".")),
          valueText,
          unit: null,
          referenceRange: `${l2}-${l3}`,
          flag: inferFlagFromText(l5),
          rawRow: `${itemName} ${l2} ${l3} ${l4} ${l5}`,
        });
        cursor += 5;
        continue;
      }

      if (
        l2 &&
        l3 &&
        l4 &&
        itemName.includes("/") &&
        isCatalystValueToken(l2) &&
        isCatalystValueToken(l3) &&
        /[-+<]?\s*\d+(?:[.,]\d+)?/.test(l4)
      ) {
        const resultMatch = l4.match(/([-+<]?\s*\d+(?:[.,]\d+)?)/);
        const valueText = resultMatch ? resultMatch[1].replace(/\s+/g, "") : l4;
        const src = lines.find((line) => line.text.trim() === itemName);
        items.push({
          page: src?.page ?? 1,
          rowY: 0,
          itemName,
          value: Number.parseFloat(valueText.replace("<", "").replace(",", ".")),
          valueText,
          unit: null,
          referenceRange: `${l2}-${l3}`,
          flag: inferFlagFromText(l4),
          rawRow: `${itemName} ${l2} ${l3} ${l4}`,
        });
        cursor += 4;
        continue;
      }

      // Vertical: 검사명 + 단위 + 단일 값만 (min/max 없음): RETIC% % 0.8, Osmolality, WBC-*% …
      if (
        l2 &&
        l3 &&
        looksLikeVerticalLabUnitLine(l2) &&
        isCatalystValueToken(l3) &&
        !hasVerticalFiveColumnTail(l3, l4, l5)
      ) {
        const valueText = l3.replace(/\s+/g, "");
        const valueNum = Number.parseFloat(valueText.replace(/^</, "").replace(",", "."));
        const src = lines.find((line) => line.text.trim() === itemName);
        items.push({
          page: src?.page ?? 1,
          rowY: 0,
          itemName,
          value: Number.isFinite(valueNum) ? valueNum : null,
          valueText,
          unit: l2,
          referenceRange: null,
          flag: inferFlagFromText(l3),
          rawRow: `${itemName}\n${l2}\n${l3}`,
        });
        cursor += 3;
        continue;
      }

      // Vertical single-result pattern: item + value (no unit/ref), optional NORMAL/HIGH/LOW on same line
      // e.g. "Osmorality" + "298", "ALB/GLOB" + "1.35 NORMAL"
      if (l2) {
        const vm = l2.match(LAB_VERTICAL_VALUE_FLAG);
        if (vm) {
          const valueText = vm[1].replace(/\s+/g, "");
          const valueNum = Number.parseFloat(valueText.replace("<", "").replace(",", "."));
          const flagTok = vm[2] ?? "";
          const src = lines.find((line) => line.text.trim() === itemName);
          items.push({
            page: src?.page ?? 1,
            rowY: 0,
            itemName,
            value: Number.isFinite(valueNum) ? valueNum : null,
            valueText,
            unit: null,
            referenceRange: null,
            flag: inferFlagFromText(valueText),
            rawRow: `${itemName} ${l2}`,
          });
          cursor += 2;
          continue;
        }
      }

      // Vertical unit+result pattern: item + unit + value (no min/max)
      // e.g. "PCT" + "%" + "0.277", "PDW-CV" + "%" + "15.3"
      if (
        l2 &&
        l3 &&
        /^[A-Za-z%/0-9.+-]+$/.test(l2) &&
        /^[-+<]?\s*\d+(?:[.,]\d+)?$/.test(l3)
      ) {
        const src = lines.find((line) => line.text.trim() === itemName);
        const valueText = l3.replace(/\s+/g, "");
        items.push({
          page: src?.page ?? 1,
          rowY: 0,
          itemName,
          value: Number.parseFloat(valueText.replace("<", "").replace(",", ".")),
          valueText,
          unit: l2,
          referenceRange: null,
          flag: "unknown",
          rawRow: `${itemName} ${l2} ${l3}`,
        });
        cursor += 3;
        continue;
      }

      cursor += 1;
    }
  }

  const unique = new Map<string, LabItem>();
  for (const item of items) {
    const key = `${item.itemName.toUpperCase()}|${item.valueText.toUpperCase()}|${item.page}`;
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()];
}

function isLikelyNoiseLabItemName(name: string | null | undefined) {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return true;
  if (/^[-+]?\d+(?:[.,]\d+)?$/.test(trimmed)) return true;
  if (!/[A-Za-z가-힣]/.test(trimmed)) return true;
  if (/(code|treatment|prescription|qty|route|sign|date\/time|performed by)/i.test(trimmed)) {
    return true;
  }
  return false;
}

function sanitizeLabItems<
  T extends { itemName: string; valueText: string; referenceRange?: string | null },
>(items: T[], chartKind?: ChartKind) {
  const normalizeLabValueText = (raw: string): string => {
    const compact = raw.replace(/\s+/g, "");
    // Strip suffix markers like "!", "H", "L" from numeric tails (e.g. 39.0!, 18.8H).
    const numericWithSuffix = compact.match(/^([<>]?\d+(?:[.,]\d+)?)(?:[!A-Za-z]+)$/);
    if (numericWithSuffix) return numericWithSuffix[1] ?? compact;
    return compact;
  };

  const normalized: T[] = items.map(
    (item) =>
      ({
        ...item,
        valueText: normalizeLabValueText(item.valueText ?? ""),
      }) as T,
  );

  const filtered = normalized.filter((item) => {
    if (isLikelyNoiseLabItemName(item.itemName)) return false;
    if (!item.valueText?.trim()) {
      if (chartKind === "efriends") {
        return Boolean(item.itemName?.trim());
      }
      return false;
    }
    return true;
  });
  const unique = new Map<string, T>();
  for (const item of filtered) {
    const key =
      chartKind === "efriends"
        ? `${item.itemName.toUpperCase().trim()}|${(item.valueText ?? "").toUpperCase().trim()}|${(item.referenceRange ?? "").toUpperCase().trim()}`
        : `${item.itemName.toUpperCase().trim()}|${item.valueText.toUpperCase().trim()}`;
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()];
}

function mapLabItemsToDateGroups(
  groups: LabByDateLinesGroup[],
  items: LabItem[],
): Array<{
  dateTime: string;
  pages: number[];
  items: Array<{
    itemName: string;
    valueText: string;
    unit: string | null;
    referenceRange: string | null;
    flag: "low" | "high" | "normal" | "unknown";
    page: number;
  }>;
}> {
  const normalizedGroups = groups.map((group) => ({
    ...group,
    normalizedText: normalizeForContains(group.lines.map((line) => line.text).join(" ")),
  }));

  const mapped = normalizedGroups.map((group) => ({
    dateTime: group.dateTime,
    pages: [...new Set(group.lines.map((line) => line.page))].sort((a, b) => a - b),
    items: [] as Array<{
      itemName: string;
      valueText: string;
      unit: string | null;
      referenceRange: string | null;
      flag: "low" | "high" | "normal" | "unknown";
      page: number;
    }>,
  }));

  for (const item of items) {
    const needleName = normalizeForContains(item.itemName);
    const needleValue = normalizeForContains(item.valueText);
    const index = normalizedGroups.findIndex((group) => {
      if (!needleName) return false;
      const hasName = group.normalizedText.includes(needleName);
      const hasValue = needleValue ? group.normalizedText.includes(needleValue) : true;
      return hasName && hasValue;
    });

    // Avoid polluting the first date-group with unmatched/noisy rows.
    if (index < 0) continue;
    mapped[index].items.push({
      itemName: item.itemName,
      valueText: item.valueText,
      unit: item.unit,
      referenceRange: item.referenceRange,
      flag: item.flag,
      page: item.page,
    });
  }

  return mapped;
}

/** 우리엔PMS 청구코드: 영문+숫자(AA001, WC00483, EVENT002) 또는 숫자-숫자(85176-109792) */
const WOORIEN_PLAN_CODE = /^(?:[A-Z]{1,6}\d{2,}|\d{4,}-\d{3,})$/i;
const WOORIEN_PLAN_HEADER_TOKEN = /^(?:plan|코드|항목명|수량|일투|일수|총투|route|dose)$/i;
const WOORIEN_PLAN_ROUTE = /^(?:po|iv|im|sc|sq|ip|io|oral|topical|경구|피하|정맥|근육)$/i;
/** 줄바꿈으로 끝에 밀려난 약물 함량 토큰(예: "5mg") — 단위가 mg/ml 등일 때만 */
const WOORIEN_STRENGTH_TOKEN = /^\d+(?:[.,]\d+)?(?:mg|mcg|ug|µg|g|kg|ml|l|iu)$/i;

/**
 * 우리엔PMS Plan 표 파서.
 * 헤더(코드 | 항목명 | 수량 | 일투 | 일수 | 총투 | Route | Dose)를 우리 표로 매핑:
 *   코드→code, 항목명→treatmentPrescription(처방), 수량 숫자→qty(수)·단위→unit(단),
 *   일수→day(일), 총투→total(계), Route→route(경로). 일투·Dose는 별도 칼럼 없음(미저장).
 * OCR/텍스트레이어가 한 행을 여러 줄로 쪼개므로(코드 줄에서 새 행 시작) 줄을 다시 묶어 파싱한다.
 */
function parseWoorienPlanRows(planText: string): ParsedPlanRow[] {
  const rawLines = planText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // 모든 토큰이 헤더 토큰인 줄(예: "Plan", "코드", "일투 일수 총투")은 제거
  const dataLines = rawLines.filter((line) => {
    const toks = line.split(/\s+/).filter(Boolean);
    return toks.length > 0 && !toks.every((t) => WOORIEN_PLAN_HEADER_TOKEN.test(t));
  });

  // 코드로 시작하는 줄에서 새 레코드 시작, 그 외는 직전 레코드에 이어붙임(줄바꿈 복구)
  const records: string[] = [];
  let buffer: string[] = [];
  const flush = () => {
    if (buffer.length > 0) records.push(buffer.join(" ").replace(/\s+/g, " ").trim());
    buffer = [];
  };
  for (const line of dataLines) {
    const first = line.split(/\s+/)[0] ?? "";
    if (WOORIEN_PLAN_CODE.test(first) && buffer.length > 0) flush();
    buffer.push(line);
  }
  flush();

  const rows: ParsedPlanRow[] = [];
  for (const record of records) {
    const allTokens = record.split(/\s+/).filter(Boolean);
    const code = allTokens[0] ?? "";
    if (!WOORIEN_PLAN_CODE.test(code)) continue;

    let tokens = allTokens.slice(1);

    // Dose: 끝의 괄호 (…) — 별도 칼럼 없으므로 제거만(raw 에 원문 유지)
    let rest = tokens.join(" ");
    const doseMatch = rest.match(/\s*\(([^)]*)\)\s*$/);
    if (doseMatch && doseMatch.index !== undefined) {
      rest = rest.slice(0, doseMatch.index).trim();
    }
    tokens = rest.split(/\s+/).filter(Boolean);

    // Route(경로)
    let route = "";
    const routeIdx = tokens.findIndex((t) => WOORIEN_PLAN_ROUTE.test(t));
    if (routeIdx >= 0) {
      route = (tokens[routeIdx] ?? "").toUpperCase();
      tokens = tokens.filter((_, i) => i !== routeIdx);
    }

    // 줄바꿈으로 끝에 밀려난 함량(예: "5mg") → 이름 접미사로 보관
    let strengthSuffix = "";
    if (tokens.length > 0 && WOORIEN_STRENGTH_TOKEN.test(tokens[tokens.length - 1] ?? "")) {
      strengthSuffix = tokens.pop()!;
    }

    // 끝의 정수 run = [일투, 일수, 총투]. 3개 이상이면 마지막 3개를 채택.
    const trailingInts: string[] = [];
    while (tokens.length > 0 && /^\d+$/.test(tokens[tokens.length - 1] ?? "")) {
      trailingInts.unshift(tokens.pop()!);
    }
    let day = "";
    let total = "";
    if (trailingInts.length >= 3) {
      day = trailingInts[trailingInts.length - 2] ?? "";
      total = trailingInts[trailingInts.length - 1] ?? "";
    }

    // 수량(수+단): 남은 토큰 끝에서 추출
    let qty = "";
    let unit = "";
    const lastTok = tokens[tokens.length - 1] ?? "";
    const prevTok = tokens[tokens.length - 2] ?? "";
    const fused = lastTok.match(/^(\d+(?:[.,]\d+)?)([^\d\s].*)$/); // "1회"
    if (/^\d+(?:[.,]\d+)?$/.test(prevTok) && /^[^\d\s]/.test(lastTok)) {
      // "14 일", "4500 mg" — 숫자 + 분리된 단위
      qty = prevTok;
      unit = lastTok;
      tokens = tokens.slice(0, -2);
    } else if (fused) {
      // "1회" — 숫자+단위 붙음
      qty = fused[1] ?? "";
      unit = fused[2] ?? "";
      tokens = tokens.slice(0, -1);
    } else if (/^\d+(?:[.,]\d+)?$/.test(lastTok)) {
      qty = lastTok;
      tokens = tokens.slice(0, -1);
    }

    let treatmentPrescription = tokens.join(" ").trim();
    if (strengthSuffix) treatmentPrescription = `${treatmentPrescription} ${strengthSuffix}`.trim();

    rows.push({
      code,
      treatmentPrescription,
      qty,
      unit,
      day,
      total,
      route,
      signId: "",
      raw: record,
    });
  }
  return rows;
}

function parsePlanRows(planText: string | null | undefined, chartKind: ChartKind = "intovet"): ParsedPlanRow[] {
  planText = planText ?? "";
  if (chartKind === "plusvet") {
    return parsePlusVetPlanRows(planText) as ParsedPlanRow[];
  }
  if (chartKind === "woorien_pms") {
    return parseWoorienPlanRows(planText);
  }
  if (chartKind === "efriends") {
    const lines = planText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) return [];

    const isHeader = (line: string) => {
      const t = line.replace(/\s+/g, " ").trim().toLowerCase();
      if (/^plan:?$/.test(t)) return true;
      if (/^date$/.test(t) || /^description$/.test(t)) return true;
      if (/^kg\s+dose\s+t\/d\s+day\s+qty\s+unit$/i.test(line.replace(/\s+/g, " ").trim())) return true;
      if (/^amount\s+doctor$/i.test(line.replace(/\s+/g, " ").trim())) return true;
      // "Plan Date Description Kg Dose t/d Day Qty Unit Amount Doctor" — all on one line
      if (/^plan\b/i.test(t) && scoreEfriendsPlanHeaderLine(t) >= 3) return true;
      return false;
    };
    const isAmountDoctorLine = (line: string) =>
      /^([\d,]+)\s*원(?:\s+.+)?$/i.test(line) && /원/.test(line);
    const isRowStart = (line: string) => /^20\d{2}[./-]\d{1,2}[./-]\d{1,2}\b/.test(line);
    const rows: ParsedPlanRow[] = [];
    let currentBlock: string[] = [];
    const flushBlock = () => {
      if (currentBlock.length === 0) return;
      const block = currentBlock.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
      currentBlock = [];
      if (block.length === 0) return;

      const firstDate = block[0]?.match(/^(20\d{2}[./-]\d{1,2}[./-]\d{1,2})\b/)?.[1];
      if (!firstDate) return;

      const amountLineIndex = block.findIndex((l) => isAmountDoctorLine(l));
      const amountLine = amountLineIndex >= 0 ? block[amountLineIndex] ?? "" : "";
      const amountDoctor = amountLine.match(/^([\d,]+)\s*원(?:\s+(.+))?$/i);
      let doctor = (amountDoctor?.[2] ?? "").trim();

      const bodyParts = block.filter((_, i) => i !== amountLineIndex);
      let mergedBody = bodyParts.join(" ").replace(/\s+/g, " ").trim();
      if (!mergedBody) return;
      mergedBody = mergedBody.replace(/^(20\d{2}[./-]\d{1,2}[./-]\d{1,2})\s*/, "").trim();
      if (!mergedBody) return;
      if (!doctor) {
        const inlineAmountDoctor = mergedBody.match(/^(.*)\s+([\d,]+)\s*원\s+(.+)$/i);
        if (inlineAmountDoctor) {
          mergedBody = (inlineAmountDoctor[1] ?? "").trim();
          doctor = (inlineAmountDoctor[3] ?? "").trim();
        }
      }
      if (!mergedBody) return;

      const tokens = mergedBody.split(/\s+/).filter(Boolean);
      const nums: string[] = [];
      while (tokens.length > 0) {
        const last = tokens[tokens.length - 1] ?? "";
        if (/^\d+(?:[.,]\d+)?$/.test(last)) {
          nums.unshift(tokens.pop()!);
        } else {
          break;
        }
      }

      // Inline format: "DESCRIPTION NUMS AMOUNT원 DOCTOR" — amount and doctor on the same row.
      // The trailing-number extraction above stops at non-numeric tokens (doctor name, 원 suffix),
      // so nums will be empty. Detect the 원 token and re-parse from the right.
      if (nums.length < 3) {
        const allTokens = mergedBody.split(/\s+/).filter(Boolean);
        const wonIdx = allTokens.reduce((found, tok, idx) => /^[\d,]+원$/.test(tok) ? idx : found, -1);
        if (wonIdx >= 0) {
          const doctorStr = allTokens.slice(wonIdx + 1).join(" ").trim();
          const numsInline: string[] = [];
          let descEnd = wonIdx;
          for (let k = wonIdx - 1; k >= 0; k -= 1) {
            if (/^[\d.,]+$/.test(allTokens[k] ?? "")) {
              numsInline.unshift(allTokens[k]!);
              descEnd = k;
            } else {
              break;
            }
          }
          const desc = allTokens.slice(0, descEnd).join(" ").trim();
          if (desc && numsInline.length >= 1) {
            rows.push({
              code: firstDate,
              treatmentPrescription: desc,
              qty: numsInline[0] ?? "",
              unit: numsInline.length >= 5 ? (numsInline[4] ?? "") : "",
              day: numsInline.length >= 3 ? (numsInline[2] ?? "") : "",
              total: numsInline.length >= 4 ? (numsInline[3] ?? "") : (numsInline[numsInline.length - 1] ?? ""),
              route: "",
              signId: doctorStr || doctor,
              raw: block.join(" "),
            });
          }
        }
        return;
      }

      const treatmentPrescription = tokens.join(" ").trim();
      if (!treatmentPrescription) return;

      rows.push({
        code: firstDate,
        treatmentPrescription,
        qty: nums[0] ?? "",
        unit: nums.length >= 5 ? (nums[4] ?? "") : "",
        day: nums.length >= 3 ? (nums[2] ?? "") : "",
        total: nums.length >= 4 ? (nums[3] ?? "") : nums[nums.length - 1] ?? "",
        route: "",
        signId: doctor,
        raw: block.join(" "),
      });
    };

    for (const line of lines) {
      if (isHeader(line)) continue;
      if (isRowStart(line) && currentBlock.length > 0) {
        flushBlock();
      }
      if (isRowStart(line) || currentBlock.length > 0) {
        currentBlock.push(line);
        if (isAmountDoctorLine(line)) {
          flushBlock();
        }
      }
    }
    flushBlock();
    return rows;
  }

  const lines = planText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const isHeaderLikeLine = (line: string) =>
    /plan|code|treatment|prescription|qty|unit|day|total|route|sign\s*id|\bresult\b|\bpart\b|\btitle\b|\bsign\b|처치실용/i.test(
      line,
    );
  // 레코드 경계용 코드 판정 — 반드시 숫자를 포함하는 청구코드 패턴만 인정한다.
  // (이전 `^[A-Z]{1,4}[A-Z0-9-]{1,}$` 는 'Metronidazole' 같은 영문 약품명까지 코드로 오인 →
  //  실제 코드는 빈 행이 되고 약품명 행이 통째로 버려지는 문제가 있었음. 행 검증의 looksLikeBillingCode 와 동일 기준.)
  const looksLikePlanCode = (token: string) => {
    if (/^(result|part|title|sign|plan|code)$/i.test(token)) return false;
    return /^(?:[A-Z]{2,}-\d{2,}(?:-\d+)?|TXTEMP\d+|[A-Z]{1,5}\d{2,})$/i.test(token);
  };
  const hasStrongRowEnding = (line: string) =>
    /\bsign\s*id\b/i.test(line) ||
    /(?:\bpo\b|\biv\b|\bim\b|\bsc\b|\bsq\b|oral|경구|피하|정맥|근육)/i.test(line);
  const dataLines = lines.filter((line) => !isHeaderLikeLine(line));
  if (dataLines.length === 0) return [];

  const records: string[] = [];
  let buffer: string[] = [];
  const flush = () => {
    if (buffer.length === 0) return;
    records.push(buffer.join(" ").replace(/\s+/g, " ").trim());
    buffer = [];
  };
  for (let i = 0; i < dataLines.length; i += 1) {
    const line = dataLines[i];
    const tokens = line.split(/\s+/).filter(Boolean);
    const first = tokens[0] ?? "";
    const hasPlanColumns = /(qty|unit|day|total|route|sign\s*id|\bcode\b|\btreatment\b)/i.test(line);
    const isStart = looksLikePlanCode(first) || hasPlanColumns;
    if (isStart && buffer.length > 0) flush();
    buffer.push(line);
    const next = dataLines[i + 1];
    if (!next) {
      flush();
      continue;
    }
    if (hasStrongRowEnding(line)) {
      const nextTokens = next.split(/\s+/).filter(Boolean);
      const nextIsStart = looksLikePlanCode(nextTokens[0] ?? "");
      if (nextIsStart) flush();
    }
  }

  const rows: ParsedPlanRow[] = [];
  const looksLikeBillingCode = (token: string) =>
    /^(?:[A-Z]{2,}-\d{2,}(?:-\d+)?|TXTEMP\d+|[A-Z]{1,4}\d{2,})$/i.test(token);
  for (const line of records) {
    const tokens = line.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;

    const code = tokens[0] ?? "";
    const routeIndex = tokens.findIndex((token) =>
      /^(po|iv|im|sc|sq|oral|경구|피하|정맥|근육)$/i.test(token),
    );
    const numericIndexes = tokens
      .map((token, index) => ({ token, index }))
      .filter((entry) => /^\d+(?:[.,]\d+)?$/.test(entry.token))
      .map((entry) => entry.index);
    const qtyIndex = numericIndexes[0] ?? -1;
    const dayIndex = numericIndexes[1] ?? -1;
    const totalIndex = numericIndexes[2] ?? -1;
    const hasCoreNumericColumns = qtyIndex >= 0 && dayIndex >= 0 && totalIndex >= 0;
    if (!looksLikeBillingCode(code) && !hasCoreNumericColumns) {
      continue;
    }

    const treatmentStart = 1;
    const treatmentEnd = qtyIndex > 1 ? qtyIndex : routeIndex > 1 ? routeIndex : tokens.length;
    const treatmentPrescription = tokens.slice(treatmentStart, treatmentEnd).join(" ");

    rows.push({
      code,
      treatmentPrescription,
      qty: qtyIndex >= 0 ? tokens[qtyIndex] : "",
      unit: qtyIndex >= 0 && qtyIndex + 1 < tokens.length ? tokens[qtyIndex + 1] : "",
      day: dayIndex >= 0 ? tokens[dayIndex] : "",
      total: totalIndex >= 0 ? tokens[totalIndex] : "",
      route: routeIndex >= 0 ? tokens[routeIndex] : "",
      signId:
        tokens.length >= 2 && /[a-z]/i.test(tokens[tokens.length - 1])
          ? tokens[tokens.length - 1]
          : "",
      raw: line,
    });
  }
  return rows;
}

function planAnchorScore(text: string) {
  const normalized = text.toLowerCase();
  let score = 0;
  if (/\bplan\b/.test(normalized)) score += 2;
  if (/\bcode\b/.test(normalized)) score += 1;
  if (/\btreatment\b|\bprescription\b/.test(normalized)) score += 1;
  if (/\bqty\b/.test(normalized)) score += 1;
  if (/\bunit\b/.test(normalized)) score += 1;
  if (/\bday\b/.test(normalized)) score += 1;
  if (/\btotal\b/.test(normalized)) score += 1;
  if (/\broute\b/.test(normalized)) score += 1;
  if (/\bsign\s*id\b/.test(normalized)) score += 1;
  return score;
}

/**
 * PlusVet: 줄 하나가 `Plan`이고, 바로 다음 줄이 표 헤더
 * `항목 용법 Qty 단위 일투 일수 사용량 담당의` 형태.
 */
function isPlusVetPlanTableHeaderLine(line: string): boolean {
  const t = line.trim().replace(/\s+/g, " ");
  if (t.length < 12) return false;
  const lower = t.toLowerCase();
  // 형식 A: 항목 + (용법|경로) + 단위 + 담당의 + qty
  if (
    t.includes("항목") &&
    (t.includes("용법") || t.includes("경로")) &&
    t.includes("단위") &&
    t.includes("담당의") &&
    lower.includes("qty")
  ) {
    return true;
  }
  // 형식 B: 한국어 컬럼 헤더(qty 없음) — "항목 경로 용량 단위 일투 일수 사용량 담당의"
  if (
    t.includes("항목") &&
    t.includes("경로") &&
    t.includes("단위") &&
    t.includes("담당의") &&
    (t.includes("사용량") || t.includes("일투") || t.includes("일수"))
  ) {
    return true;
  }
  return false;
}

function isPlusVetPlanNextLineIndicator(next: string): boolean {
  if (isPlusVetPlanTableHeaderLine(next)) return true;
  return /^(항목|경로|용법|qty)$/i.test(next.trim());
}

function findPlusVetPlanStartIndex(lines: string[]): number {
  for (let i = 0; i < lines.length - 1; i += 1) {
    const cur = (lines[i] ?? "").trim();
    if (!/^plan$/i.test(cur)) continue;
    if (isPlusVetPlanNextLineIndicator(lines[i + 1] ?? "")) {
      return i;
    }
  }
  return -1;
}

function splitPlusVetSoapSections(texts: string[]): {
  bodyText: string;
  planText: string;
  planDetected: boolean;
} {
  let diagnosticResultsIdx = -1;
  let subjectiveIdx = -1;
  let objectiveIdx = -1;
  let planIdx = -1;

  for (let i = 0; i < texts.length; i += 1) {
    const t = (texts[i] ?? "").trim();
    if (diagnosticResultsIdx < 0 && /진단\s*검사\s*결과/.test(t)) {
      diagnosticResultsIdx = i;
      break;
    }
    if (subjectiveIdx < 0 && /^subjective$/i.test(t)) { subjectiveIdx = i; continue; }
    if (objectiveIdx < 0 && /^objective$/i.test(t)) { objectiveIdx = i; continue; }
    if (planIdx < 0 && /^plan$/i.test(t)) {
      const hasSoapContext = subjectiveIdx >= 0 || objectiveIdx >= 0;
      if (hasSoapContext || isPlusVetPlanNextLineIndicator(texts[i + 1] ?? "")) {
        planIdx = i;
      }
    }
  }

  console.log("[splitPlusVetSoapSections] lines=%d subjectiveIdx=%d objectiveIdx=%d planIdx=%d diagnosticResultsIdx=%d", texts.length, subjectiveIdx, objectiveIdx, planIdx, diagnosticResultsIdx);
  if (planIdx < 0) {
    console.log("[splitPlusVetSoapSections] Plan 미탐지. 전체 texts:", JSON.stringify(texts));
  }

  const cutoff = diagnosticResultsIdx >= 0 ? diagnosticResultsIdx : texts.length;
  const hasSoap = subjectiveIdx >= 0 || objectiveIdx >= 0 || planIdx >= 0;

  if (!hasSoap) {
    const fallbackPlan = findPlusVetPlanStartIndex(texts.slice(0, cutoff));
    return {
      bodyText: fallbackPlan >= 0 ? texts.slice(0, fallbackPlan).join("\n").trim() : texts.slice(0, cutoff).join("\n").trim(),
      planText: fallbackPlan >= 0 ? texts.slice(fallbackPlan, cutoff).join("\n").trim() : "",
      planDetected: fallbackPlan >= 0,
    };
  }

  const bodyEnd = Math.min(
    objectiveIdx >= 0 ? objectiveIdx : planIdx >= 0 ? planIdx : cutoff,
    cutoff,
  );

  let bodyLines: string[];
  if (subjectiveIdx >= 0) {
    bodyLines = [...texts.slice(0, subjectiveIdx), ...texts.slice(subjectiveIdx + 1, bodyEnd)];
  } else {
    bodyLines = texts.slice(0, bodyEnd);
  }

  const planText = planIdx >= 0 ? texts.slice(planIdx, cutoff).join("\n").trim() : "";

  return {
    bodyText: bodyLines.join("\n").trim(),
    planText,
    planDetected: planIdx >= 0,
  };
}

/** IntoVet 등: 영문 Plan/Code/Qty… 헤더 누적 점수 */
function findIntoVetStylePlanStartIndex(lines: string[]): number {
  for (let i = 0; i < lines.length; i += 1) {
    let score = planAnchorScore(lines[i]);
    for (let lookahead = 1; lookahead <= 3; lookahead += 1) {
      const next = lines[i + lookahead];
      if (!next) break;
      score += planAnchorScore(next);
    }
    if (score >= 4) {
      return i;
    }
  }
  return -1;
}

function scoreEfriendsPlanHeaderLine(t: string): number {
  let score = 0;
  if (/\bdate\b/.test(t)) score += 1;
  if (/\bdescription\b/.test(t)) score += 1;
  if (/\bamount\b/.test(t)) score += 2;
  if (/\bdoctor\b/.test(t)) score += 1;
  if (/\bkg\b/.test(t) && /\bdose\b/.test(t) && /\bday\b/.test(t)) score += 2;
  return score;
}

function findPlanStartIndex(lines: string[], chartKind: ChartKind): number {
  if (chartKind === "efriends") {
    for (let i = 0; i < lines.length; i += 1) {
      const cur = (lines[i] ?? "").trim().replace(/\s+/g, " ");
      if (!/^plan\b/i.test(cur)) continue;
      const lower = cur.toLowerCase();

      // Case A: "Plan" alone on its own line — score subsequent lines for headers
      if (/^plan:?$/i.test(cur)) {
        let score = 0;
        for (let j = i + 1; j < Math.min(lines.length, i + 14); j += 1) {
          const raw = (lines[j] ?? "").trim().replace(/\s+/g, " ");
          const t = raw.toLowerCase();
          if (t === "date" || t === "description") score += 1;
          if (/^kg dose t\/d day qty unit$/.test(t)) score += 2;
          else if (/kg/.test(t) && /dose/.test(t) && /day/.test(t) && /qty/.test(t) && /unit/.test(t)) score += 2;
          if (/^amount doctor$/.test(t)) score += 2;
        }
        if (score >= 3) return i;
        continue;
      }

      // Case B: "Plan Date Description … Amount Doctor" all on one line
      if (scoreEfriendsPlanHeaderLine(lower) >= 3) return i;
    }
    return -1;
  }
  if (chartKind === "woorien_pms") {
    return findWoorienPlanStartIndex(lines);
  }
  if (chartKind === "plusvet" || chartKind === "other") {
    return findPlusVetPlanStartIndex(lines);
  }
  return findIntoVetStylePlanStartIndex(lines);
}

/**
 * 우리엔PMS Plan 헤더: `Plan` 단독 줄 뒤에 한글 표 헤더(코드/항목명/수량/일투/일수/총투, Route/Dose)가
 * 한 줄씩 또는 묶여서(`일투 일수 총투`) 따라온다. 그 토큰들이 충분히 나오면 `Plan` 줄을 시작점으로 본다.
 */
function findWoorienPlanStartIndex(lines: string[]): number {
  const headerToken = /^(?:코드|항목명|수량|일투|일수|총투|route|dose)$/i;
  for (let i = 0; i < lines.length; i += 1) {
    const cur = (lines[i] ?? "").trim().replace(/\s+/g, " ");
    if (!/^plan:?$/i.test(cur)) continue;
    let score = 0;
    for (let j = i + 1; j < Math.min(lines.length, i + 10); j += 1) {
      for (const part of (lines[j] ?? "").trim().split(/\s+/)) {
        if (headerToken.test(part)) score += 1;
      }
    }
    if (score >= 3) return i;
  }
  return -1;
}

function buildPlanLineScores(lines: string[]) {
  return lines.map((line, index) => {
    let score = planAnchorScore(line);
    for (let lookahead = 1; lookahead <= 3; lookahead += 1) {
      const next = lines[index + lookahead];
      if (!next) break;
      score += planAnchorScore(next);
    }
    return { index, line, score };
  });
}

async function extractLabItemsForBucket(
  labLines: BucketedLine[],
  ocrRows: OcrRow[] = [],
): Promise<{ items: LabItem[]; source: "llm" | "rules" | "empty"; llmError: string | null }> {
  if (labLines.length === 0) {
    return { items: [], source: "empty", llmError: null };
  }

  const labText = labLines.map((line) => line.text).join("\n");
  const rowContext: OcrRow[] = labLines.map((line, index) => ({
    page: 1,
    y: (index + 1) * 10,
    text: line.text,
    tokens: line.text.split(/\s+/).map((token) => token.trim()).filter(Boolean),
    xMin: null,
    xMax: null,
    yMin: null,
    yMax: null,
  }));

  const tableBlocks = detectTableBlocks(rowContext);
  const tableRows = rowsFromTableBlocks(rowContext, tableBlocks);
  const ruleItemsFromLlmTableRows = extractLabItems(tableRows);
  const ruleItemsFromLlmAllRows = extractLabItems(rowContext);

  // Supplemental OCR rows help recover rows broken by LLM line wrapping.
  // We keep this narrow (name/value overlap with lab bucket text) to avoid noise.
  const ocrCandidates = ocrRows.filter((row) => {
    if (!(row.text ?? "").trim()) return false;
    const hasLabKeywords =
      /\b(alt|ast|alp|alb|glob|bun|crea|glu|wbc|rbc|hgb|hct|plt|crp|alb\/glob|bun\/crea|name|unit|result|reference|performed by|lab)\b/i.test(
        row.text,
      );
    return hasLabKeywords;
  });
  const ocrTableBlocks = detectTableBlocks(ocrCandidates);
  const ocrTableRows = rowsFromTableBlocks(ocrCandidates, ocrTableBlocks);
  const ruleItemsFromOcrTableRows = extractLabItems(ocrTableRows);
  const ruleItemsFromOcrAllRows = extractLabItems(ocrCandidates);

  const mergedRuleItemsMap = new Map<string, LabItem>();
  for (const item of [
    ...ruleItemsFromLlmTableRows,
    ...ruleItemsFromLlmAllRows,
    ...ruleItemsFromOcrTableRows,
    ...ruleItemsFromOcrAllRows,
  ]) {
    const key = `${item.itemName.toUpperCase().trim()}|${item.valueText.toUpperCase().trim()}`;
    if (!mergedRuleItemsMap.has(key)) {
      mergedRuleItemsMap.set(key, item);
    }
  }
  const ruleItems = [...mergedRuleItemsMap.values()];
  if (!hasLlmApiKey()) {
    return { items: ruleItems, source: ruleItems.length > 0 ? "rules" : "empty", llmError: null };
  }

  let llmError: string | null = null;
  try {
    const llm = await extractLabItemsWithLlm({
      text: labText,
      rows: tableRows.length > 0 ? tableRows : rowContext,
    });
    if (llm.labItems.length > 0 && ruleItems.length === 0) {
      return { items: llm.labItems, source: "llm", llmError: null };
    }
    if (llm.labItems.length > 0 && ruleItems.length > 0) {
      const llmNames = new Set(llm.labItems.map((item) => item.itemName.toUpperCase().trim()));
      const ruleNames = new Set(ruleItems.map((item) => item.itemName.toUpperCase().trim()));
      const criticalInRules = ruleItems.filter((item) =>
        /\b(CRP|ALB\/GLOB|BUN\/CREA)\b/i.test(item.itemName),
      );
      const missingCritical = criticalInRules.some(
        (item) => !llmNames.has(item.itemName.toUpperCase().trim()),
      );
      const llmCoverage = llmNames.size / Math.max(1, ruleNames.size);

      // Safety-first selection:
      // - If LLM missed critical analytes found by rules, prefer rules.
      // - If LLM coverage is much lower than rules, prefer rules.
      if (!missingCritical && llmCoverage >= 0.7) {
        return { items: llm.labItems, source: "llm", llmError: null };
      }
      return { items: ruleItems, source: "rules", llmError: null };
    }
  } catch (error) {
    llmError = error instanceof Error ? error.message : "LLM lab extract failed";
  }

  return { items: ruleItems, source: ruleItems.length > 0 ? "rules" : "empty", llmError };
}

async function rollbackParseRunArtifacts(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  parseRunId: string | null,
  documentId: string | null,
) {
  const pdfDb = dbChartPdf(supabase);
  if (parseRunId) {
    await pdfDb.from("parse_runs").delete().eq("id", parseRunId);
  }
  if (documentId) {
    await pdfDb.from("documents").delete().eq("id", documentId);
  }
}

/** hospitals·hospital_pdf_merge_map → core 스키마(SUPABASE_SCHEMA_CORE 또는 통합 SUPABASE_DB_SCHEMA) */
type CoreHospitalRow = {
  id: string;
  name: string | null;
  code: string | null;
  slug: string | null;
};

async function loadCoreHospitalRow(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  hospitalId: string,
): Promise<CoreHospitalRow> {
  const sel = hospitalsDbUsesCamelCase() ? "id, name, code, slug" : "id, name_ko, code, slug";

  const coreDb = dbCore(supabase);

  function normalizeHospitalLookupRow(raw: Record<string, unknown>): CoreHospitalRow {
    const id = typeof raw.id === "string" ? raw.id : "";
    const name =
      (typeof raw.name === "string" ? raw.name : null) ??
      (typeof raw.name_ko === "string" ? raw.name_ko : null);
    return {
      id,
      name,
      code: typeof raw.code === "string" ? raw.code : null,
      slug: typeof raw.slug === "string" ? raw.slug : null,
    };
  }

  const { data: direct, error: directErr } = await coreDb
    .from("hospitals")
    .select(sel)
    .eq("id", hospitalId)
    .maybeSingle();

  if (directErr) {
    throw new Error(`병원 정보를 찾을 수 없습니다: ${directErr.message}`);
  }

  let row: CoreHospitalRow | null = direct
    ? normalizeHospitalLookupRow(direct as Record<string, unknown>)
    : null;

  if (!row) {
    const { data: mapped, error: mapErr } = await coreDb
      .from("hospital_pdf_merge_map")
      .select("core_hospital_id")
      .eq("source_hospital_id", hospitalId)
      .maybeSingle();

    if (mapErr) {
      throw new Error(`병원 정보를 찾을 수 없습니다: ${mapErr.message}`);
    }

    if (mapped?.core_hospital_id) {
      const { data: resolved, error: resErr } = await coreDb
        .from("hospitals")
        .select(sel)
        .eq("id", mapped.core_hospital_id)
        .maybeSingle();

      if (resErr) {
        throw new Error(`병원 정보를 찾을 수 없습니다: ${resErr.message}`);
      }
      row = resolved ? normalizeHospitalLookupRow(resolved as Record<string, unknown>) : null;
    }
  }

  if (!row) {
    throw new Error(
      `병원 정보를 찾을 수 없습니다: hospitals 에서 id=${hospitalId} 가 없습니다. PDF 레거시 병원이면 hospital_pdf_merge_map 을 확인하세요. (${getSupabaseCoreSchema()} 스키마)`,
    );
  }

  return row;
}

let saveSubStage = ""; // 디버그(임시): saveParseRun 내부 단계 추적
async function saveParseRun(params: {
  fileName: string;
  chartType: ChartKind;
  provider: string;
  model: string;
  parserVersion: string;
  rawPayload: unknown;
  fileBuffer: Buffer;
  chartBodyByDate: Array<{
    dateTime: string;
    bodyText: string;
    planText: string;
    planDetected: boolean;
  }>;
  labItemsByDate: Array<{
    dateTime: string;
    items: Array<{
      itemName: string;
      rawItemName: string;
      valueText: string;
      unit: string | null;
      referenceRange: string | null;
      flag: "low" | "high" | "normal" | "unknown";
    }>;
  }>;
  vaccinationRecords: ParsedVaccinationRecord[];
  vitals: ParsedVitalRow[];
  physicalExamItems: ParsedPhysicalExamItem[];
  basicInfoParsed: ParsedBasicInfo;
  /** 마스터 hospitals.id — friendly_id·기본정보 병원명에 사용 */
  hospitalId: string;
  /** 설정 시 재추출(덮어쓰기): 기존 run/document 재사용 + 파생행 삭제 후 재삽입(run_id·friendly_id·연결 유지). */
  replaceRunId?: string;
}): Promise<{ runId: string; friendlyId: string }> {
  const supabase = getSupabaseServerClient();
  const hospitalRow = await loadCoreHospitalRow(supabase, params.hospitalId);
  const db = dbChartPdf(supabase);

  const fileHash = createHash("sha256").update(params.fileBuffer).digest("hex");
  let documentId: string | null = null;
  let parseRunId: string | null = null;
  let existingFriendlyId: string | null = null;
  let runCreatedAt = "";

  try {
    if (params.replaceRunId) {
      // 재추출(덮어쓰기): 기존 run/document 재사용 + 파생행 삭제 후 아래에서 재삽입. run_id 유지 → 케이스 연결 보존.
      const { data: existing, error: exErr } = await db
        .from("parse_runs")
        .select("id, document_id, created_at, friendly_id")
        .eq("id", params.replaceRunId)
        .single();
      if (exErr || !existing) {
        throw new Error(`재추출 대상 run 없음: ${exErr?.message ?? params.replaceRunId}`);
      }
      parseRunId = existing.id as string;
      documentId = existing.document_id as string;
      runCreatedAt = existing.created_at as string;
      existingFriendlyId = (existing.friendly_id as string | null) ?? null;
      // 기존 파생행 삭제 — chart_by_date_id FK 자식(vitals/physical/plan)을 chart_by_date 보다 먼저.
      const derivedTables = [
        "result_vitals",
        "result_physical_exam_items",
        "result_plan_rows",
        "result_chart_by_date",
        "result_lab_items",
        "result_vaccination_records",
        "result_basic_info",
      ];
      for (const t of derivedTables) {
        const { error: delErr } = await db.from(t).delete().eq("parse_run_id", parseRunId);
        if (delErr) throw new Error(`${t} 삭제 실패(재추출): ${delErr.message}`);
      }
      await db.from("documents").update({ chart_type: params.chartType, file_hash: fileHash }).eq("id", documentId);
      const { error: updErr } = await db
        .from("parse_runs")
        .update({
          status: "success",
          provider: params.provider,
          model: params.model,
          parser_version: params.parserVersion,
          raw_payload: params.rawPayload,
          error_message: null,
        })
        .eq("id", parseRunId);
      if (updErr) throw new Error(`parse_runs 갱신 실패(재추출): ${updErr.message}`);
    } else {
      const { data: document, error: docError } = await db
        .from("documents")
        .insert({
          file_name: params.fileName,
          file_hash: fileHash,
          chart_type: params.chartType,
        })
        .select("id")
        .single();

      if (docError || !document) {
        throw new Error(`documents insert failed: ${docError?.message ?? "unknown"}`);
      }
      documentId = document.id as string;

      const { data: runRow, error: runError } = await db
        .from("parse_runs")
        .insert({
          document_id: documentId,
          hospital_id: hospitalRow.id,
          status: "success",
          provider: params.provider,
          model: params.model,
          parser_version: params.parserVersion,
          raw_payload: params.rawPayload,
          error_message: null,
        })
        .select("id, created_at")
        .single();

      if (runError || !runRow) {
        throw new Error(`parse_runs insert failed: ${runError?.message ?? "unknown"}`);
      }
      parseRunId = runRow.id as string;
      runCreatedAt = runRow.created_at as string;
    }

    saveSubStage = "chartRows";
    let chartRowsInserted: Array<{ id: string; date_time: string; row_order: number | null }> = [];
    if (params.chartBodyByDate.length > 0) {
      const chartRows = params.chartBodyByDate.map((group, index) => ({
        parse_run_id: parseRunId,
        date_time: group.dateTime,
        body_text: group.bodyText,
        plan_text: group.planText,
        plan_detected: group.planDetected,
        row_order: index,
      }));
      const { data: chartInserted, error: chartError } = await db
        .from("result_chart_by_date")
        .insert(chartRows)
        .select("id,date_time,row_order");
      if (chartError || !chartInserted) {
        throw new Error(`result_chart_by_date insert failed: ${chartError?.message ?? "unknown"}`);
      }
      chartRowsInserted = chartInserted as Array<{ id: string; date_time: string; row_order: number | null }>;
    }

    saveSubStage = "labRows";
    const labRows = params.labItemsByDate.flatMap((group, groupIndex) =>
      group.items.map((item, itemIndex) => ({
        parse_run_id: parseRunId,
        date_time: group.dateTime,
        item_name: item.itemName,
        raw_item_name: item.rawItemName,
        value_text: item.valueText,
        unit: item.unit,
        reference_range: item.referenceRange,
        flag: item.flag,
        row_order: groupIndex * 1000 + itemIndex,
      })),
    );
    if (labRows.length > 0) {
      const { error: labError } = await db.from("result_lab_items").insert(labRows);
      if (labError) {
        throw new Error(`result_lab_items insert failed: ${labError.message}`);
      }
    }

    if (params.vaccinationRecords.length > 0) {
      saveSubStage = "vacRows";
      const vacRows = params.vaccinationRecords.map((r, index) => ({
        parse_run_id: parseRunId,
        record_type: r.recordType,
        dose_order: r.doseOrder,
        product_name: r.productName,
        administered_date: r.administeredDate,
        sign: r.sign,
        row_order: index,
      }));
      const { error: vacError } = await db.from("result_vaccination_records").insert(vacRows);
      if (vacError) {
        throw new Error(`result_vaccination_records insert failed: ${vacError.message}`);
      }
    }

    if (params.vitals.length > 0) {
      saveSubStage = "vitalRows";
      const vitalRows = params.vitals.map((row, index) => ({
        parse_run_id: parseRunId,
        chart_by_date_id: findNearestChartRowId(
          row.dateTime,
          chartRowsInserted.map((c) => ({ id: c.id, date_time: c.date_time })),
          20,
        ),
        date_time: row.dateTime,
        weight: row.weight,
        temperature: row.temperature,
        respiratory_rate: row.respiratoryRate,
        heart_rate: row.heartRate,
        bp_systolic: row.bpSystolic,
        bp_diastolic: row.bpDiastolic,
        raw_text: row.rawText,
        row_order: index,
      }));
      const { error: vitalsError } = await db.from("result_vitals").insert(vitalRows);
      if (vitalsError) {
        throw new Error(`result_vitals insert failed: ${vitalsError.message}`);
      }
    }

    if (params.physicalExamItems.length > 0) {
      saveSubStage = "physicalRows";
      const physicalRows = params.physicalExamItems.map((item, index) => ({
        parse_run_id: parseRunId,
        chart_by_date_id: findNearestChartRowId(
          item.dateTime,
          chartRowsInserted.map((c) => ({ id: c.id, date_time: c.date_time })),
          20,
        ),
        date_time: item.dateTime,
        item_name: item.itemName,
        reference_range: item.referenceRange,
        value_text: item.valueText,
        unit: item.unit,
        raw_text: item.rawText,
        row_order: index,
      }));
      const { error: physicalError } = await db.from("result_physical_exam_items").insert(physicalRows);
      if (physicalError) {
        const msg = physicalError.message ?? "";
        const missingTable =
          /result_physical_exam_items/i.test(msg) &&
          /(schema cache|could not find the table|does not exist)/i.test(msg);
        if (!missingTable) {
          throw new Error(`result_physical_exam_items insert failed: ${physicalError.message}`);
        }
        // Backward-compatible fallback: allow parsing to continue until DB migration is applied.
        console.warn(
          "[text-bucketing] result_physical_exam_items table is missing; skipping physical exam item persistence.",
        );
      }
    }

    saveSubStage = "planRows";
    const planRows: Array<Record<string, unknown>> = [];
    for (const [groupIndex, row] of chartRowsInserted.entries()) {
      const matched = params.chartBodyByDate.find((group) => group.dateTime === row.date_time);
      const planText = (matched?.planText ?? "").trim();
      if (!planText) continue;

      // woorien: 줄 추출이 표를 흩뜨려(긴 항목명이 줄바꿈되며 다음 코드와 섞임) 정규식 파싱이 꼬임
      //   → Gemini 로 표 행을 구조화 복원(실패 시 정규식 파서로 폴백).
      let parsed: ParsedPlanRow[];
      if (params.chartType === "woorien_pms") {
        const llm = await reconstructPlanRowsFromText(planText);
        parsed =
          llm && llm.length > 0
            ? llm.map((r) => ({
                code: r.code ?? "",
                treatmentPrescription: r.name ?? "",
                qty: r.qty ?? "",
                unit: r.unit ?? "",
                day: r.day ?? "",
                total: r.total ?? "",
                route: r.route ?? "",
                signId: "",
                raw: [r.code, r.name, r.qty, r.unit, r.day, r.total, r.route].filter(Boolean).join(" "),
              }))
            : parsePlanRows(planText, params.chartType);
      } else {
        parsed = parsePlanRows(planText, params.chartType);
      }

      parsed.forEach((plan, itemIndex) => {
        planRows.push({
          parse_run_id: parseRunId,
          chart_by_date_id: row.id,
          code: plan.code || null,
          treatment_prescription: plan.treatmentPrescription || null,
          qty: plan.qty || null,
          unit: plan.unit || null,
          day: plan.day || null,
          total: plan.total || null,
          route: plan.route || null,
          sign_id: plan.signId || null,
          raw_text: plan.raw,
          row_order: groupIndex * 1000 + itemIndex,
        });
      });
    }
    if (planRows.length > 0) {
      const { error: planError } = await db.from("result_plan_rows").insert(planRows);
      if (planError) {
        throw new Error(`result_plan_rows insert failed: ${planError.message}`);
      }
    }

    saveSubStage = "finalizeBasicInfo";
    const basicFinal = finalizeBasicInfoBirthAndAge(params.chartType, params.basicInfoParsed, {
      chartBodyByDate: params.chartBodyByDate,
      labItemsByDate: params.labItemsByDate,
      runCreatedAtIso: runCreatedAt,
    });

    const { error: basicInfoError } = await db.from("result_basic_info").insert({
      parse_run_id: parseRunId,
      hospital_name: hospitalRow.name ?? "",
      owner_name: basicFinal.ownerName,
      patient_name: basicFinal.patientName,
      species: basicFinal.species,
      breed: basicFinal.breed,
      birth: basicFinal.birth,
      age: basicFinal.age,
      sex: basicFinal.sex,
    });
    if (basicInfoError) {
      throw new Error(`result_basic_info insert failed: ${basicInfoError.message}`);
    }

    saveSubStage = "friendlyId";
    // 재추출이면 기존 friendly_id 유지(케이스 식별자 보존). 없으면 새로 부여.
    const friendlyId = existingFriendlyId ?? await assignFriendlyIdToParseRun(supabase, parseRunId, runCreatedAt, {
      hospitalId: hospitalRow.id as string,
      hospitalSlug: (((hospitalRow.code as string | null) ?? (hospitalRow.slug as string | null) ?? (hospitalRow.id as string) ?? "chart") as string),
    });

    return { runId: parseRunId, friendlyId };
  } catch (error) {
    // 재추출(덮어쓰기)은 기존 run 을 지우면 안 됨(케이스 연결 유지) → 롤백 생략(부분 상태면 admin 재시도).
    if (!params.replaceRunId) {
      await rollbackParseRunArtifacts(supabase, parseRunId, documentId);
    }
    throw error;
  }
}

export async function POST(request: NextRequest) {
  const authErr = chartAppAuthMiddleware(request);
  if (authErr) return authErr;

  console.log("[text-bucketing] POST 수신 content-type:", request.headers.get("content-type"));

  let stage = "init"; // 디버그(임시): 크래시 단계 추적
  try {
    const labDebugEnabled = process.env.LAB_DEBUG === "true";
    const formData = await request.formData();
    const file = formData.get("file");
    const storageBucketRaw = formData.get("storageBucket");
    const storagePathRaw = formData.get("storagePath");
    const storagePathsRaw = formData.get("storagePaths"); // JSON 배열 문자열(다중 PDF). 있으면 storagePath보다 우선.
    const storageFileNameRaw = formData.get("fileName");
    const storageFileTypeRaw = formData.get("fileType");
    const chartType = parseChartKind(formData.get("chartType"));
    const hospitalIdRaw = formData.get("hospitalId");
    const hospitalId =
      typeof hospitalIdRaw === "string" ? hospitalIdRaw.trim() : "";
    console.log("[text-bucketing] 파싱 결과: chartType=%s hospitalId=%s file=%s storageBucket=%s storagePath=%s",
      chartType, hospitalId || "(empty)", file instanceof File ? `File(${(file as File).name})` : String(file),
      storageBucketRaw, storagePathRaw);
    if (!hospitalId || !HOSPITAL_UUID_RE.test(hospitalId)) {
      console.log("[text-bucketing] hospitalId 검증 실패:", hospitalId);
      return Response.json({ error: "병원을 선택해 주세요." }, { status: 400 });
    }

    // 과금: 이 추출 작업의 operationId + 사전 잔액 점검(0 이하면 차단, 토큰 미설정이면 통과).
    // product: 호출부(processExtractJob)가 job.kind 로 넘긴 상품 코드(case_blog/health_report). 추출 차감을 상품에 귀속.
    const productRaw = formData.get("product");
    const extractProduct = typeof productRaw === "string" && productRaw.trim() ? productRaw.trim() : null;
    // 재추출(admin): 설정 시 새 run 대신 이 run 을 덮어쓴다.
    const replaceRunIdRaw = formData.get("replaceRunId");
    const replaceRunId =
      typeof replaceRunIdRaw === "string" && HOSPITAL_UUID_RE.test(replaceRunIdRaw.trim())
        ? replaceRunIdRaw.trim()
        : undefined;
    const extractOperationId = crypto.randomUUID();
    if (!(await hospitalHasTokens(hospitalId))) {
      return Response.json(
        { error: "토큰이 부족합니다. 충전 후 다시 시도해 주세요." },
        { status: 402 },
      );
    }

    const chartPasteRaw = formData.get("chartPasteText");
    const chartPasteText = typeof chartPasteRaw === "string" ? chartPasteRaw.trim() : "";
    const efriendsChartBlocks = parseEfriendsChartBlocksFromFormJson(formData.get("efriendsChartBlocksJson"));

    let binary: Buffer;
    let sourceFileName = "report.pdf";
    let sourceFileType = "application/pdf";
    // 재추출(admin)용: 원본 PDF의 storage 경로를 run 에 보관한다(직접 업로드면 비어 있음 → 재추출 불가).
    let sourceStorageBucket = "";
    let sourceStoragePaths: string[] = [];

    // 직접 업로드된 파일(다중 가능) — getAll("file")
    const uploadedFiles = formData.getAll("file").filter((f): f is File => f instanceof File);

    if (uploadedFiles.length > 0) {
      const buffers: Buffer[] = [];
      for (const f of uploadedFiles) {
        if (f.type !== "application/pdf") {
          return Response.json({ error: "Text 기반 버켓팅 테스트는 PDF만 지원합니다." }, { status: 400 });
        }
        if (f.size > MAX_FILE_SIZE_BYTES) {
          return Response.json({ error: "파일 크기는 각 30MB 이하여야 합니다." }, { status: 400 });
        }
        buffers.push(Buffer.from(await f.arrayBuffer()));
      }
      sourceFileName = uploadedFiles[0].name || sourceFileName;
      sourceFileType = "application/pdf";
      binary = await mergePdfs(buffers);
      if (uploadedFiles.length > 1) {
        console.log("[text-bucketing] %d개 PDF 머지 완료 (직접 업로드)", uploadedFiles.length);
      }
    } else {
      const storageBucket =
        typeof storageBucketRaw === "string" ? storageBucketRaw.trim() : "";
      const storageFileName =
        typeof storageFileNameRaw === "string" ? storageFileNameRaw.trim() : "";
      const storageFileType =
        typeof storageFileTypeRaw === "string" ? storageFileTypeRaw.trim() : "";

      // storagePaths(JSON 배열)가 있으면 우선, 없으면 단일 storagePath
      let storagePaths: string[] = [];
      if (typeof storagePathsRaw === "string" && storagePathsRaw.trim()) {
        try {
          const parsed = JSON.parse(storagePathsRaw);
          if (Array.isArray(parsed)) {
            storagePaths = parsed.filter((p): p is string => typeof p === "string" && p.trim().length > 0).map((p) => p.trim());
          }
        } catch {
          return Response.json({ error: "storagePaths 형식이 올바르지 않습니다(JSON 배열)." }, { status: 400 });
        }
      }
      if (storagePaths.length === 0 && typeof storagePathRaw === "string" && storagePathRaw.trim()) {
        storagePaths = [storagePathRaw.trim()];
      }

      if (!storageBucket || storagePaths.length === 0) {
        return Response.json(
          { error: "업로드 파일 또는 storage 경로가 필요합니다. (field: file | storagePath | storagePaths)" },
          { status: 400 },
        );
      }
      if (storageBucket !== EXTRACT_UPLOAD_BUCKET) {
        return Response.json({ error: "허용되지 않은 storage bucket입니다." }, { status: 400 });
      }
      for (const p of storagePaths) {
        if (!p.startsWith("extract-uploads/")) {
          return Response.json({ error: "허용되지 않은 storage path입니다." }, { status: 400 });
        }
      }
      if (storageFileType && storageFileType !== "application/pdf") {
        return Response.json({ error: "Text 기반 버켓팅 테스트는 PDF만 지원합니다." }, { status: 400 });
      }

      sourceStorageBucket = storageBucket;
      sourceStoragePaths = storagePaths;

      const supabase = getSupabaseServerClient();
      const buffers: Buffer[] = [];
      for (const storagePath of storagePaths) {
        console.log("[text-bucketing] Supabase storage 다운로드 시작: bucket=%s path=%s", storageBucket, storagePath);
        const { data: downloaded, error: downloadError } = await supabase.storage
          .from(storageBucket)
          .download(storagePath);
        if (downloadError || !downloaded) {
          console.log("[text-bucketing] Storage 다운로드 실패:", downloadError?.message);
          return Response.json(
            { error: `업로드된 PDF를 불러오지 못했습니다: ${downloadError?.message ?? "unknown"}` },
            { status: 400 },
          );
        }
        console.log("[text-bucketing] Storage 다운로드 성공: size=%d", downloaded.size);
        if (downloaded.size > MAX_FILE_SIZE_BYTES) {
          return Response.json({ error: "파일 크기는 각 30MB 이하여야 합니다." }, { status: 400 });
        }
        buffers.push(Buffer.from(await downloaded.arrayBuffer()));
      }
      binary = await mergePdfs(buffers);
      if (storagePaths.length > 1) {
        console.log("[text-bucketing] %d개 PDF 머지 완료 (storage)", storagePaths.length);
      }
      sourceFileName = storageFileName || sourceFileName;
      sourceFileType = storageFileType || sourceFileType;
    }

    // 페이지 수 가드 — 너무 많은 페이지는 파싱이 시간(타임아웃)을 초과하므로 파싱 전에 거부.
    const MAX_PAGES = Number(process.env.TEXT_BUCKETING_MAX_PAGES) || 40;
    try {
      const pageCount = await getPdfPageCount(binary);
      console.log("[text-bucketing] PDF 페이지 수: %d (제한 %d)", pageCount, MAX_PAGES);
      if (pageCount > MAX_PAGES) {
        return Response.json(
          {
            error: `PDF가 너무 깁니다 (${pageCount}페이지). 한 번에 ${MAX_PAGES}페이지까지만 분석할 수 있어요. 해당 진료분 페이지만 잘라서 올려주세요.`,
          },
          { status: 413 },
        );
      }
    } catch (e) {
      console.log("[text-bucketing] 페이지 수 확인 실패(무시):", (e as Error)?.message);
    }

    if (!hasLlmApiKey()) {
      return Response.json({ error: "현재 LLM provider API key가 설정되지 않았습니다." }, { status: 400 });
    }

    const ocrConfigured = Boolean(process.env.GOOGLE_CLOUD_CLIENT_EMAIL && process.env.GOOGLE_CLOUD_PRIVATE_KEY &&
      (sourceFileType !== 'application/pdf' || process.env.GOOGLE_CLOUD_OCR_INPUT_BUCKET));
    console.log(`[text-bucketing DEBUG] ocrConfigured=${ocrConfigured} fileType=${sourceFileType}`);
    const emptyOcr: import('@/lib/google-vision').VisionOcrResult = { text: '', confidence: null, rows: [] };

    // PlusVet: 임베디드 텍스트 레이어가 충실하면 그것을 1순위 추출 경로로 쓴다.
    // Gemini 이미지 전사는 반복 블록(여러 진료에 동일한 Problem list/DDX)을 스킵하고 순서를 잃을 수 있으나,
    // 텍스트 레이어는 누락 없이 시각 순서를 보존한다(+ 더 빠르고 저렴 → 타임아웃 위험↓). 스캔 PDF면 게이트에서 탈락 → Gemini 폴백.
    let textLayerLines: OrderedLine[] | null = null;
    if (chartType === "plusvet") {
      try {
        const tl = await extractOrderedLinesFromTextLayer(binary);
        if (isTextLayerSufficient(tl)) textLayerLines = tl.lines;
        console.log(
          `[text-bucketing] plusvet 텍스트레이어: pages=${tl.numPages} lines=${tl.lines.length} sufficient=${textLayerLines !== null}`,
        );
      } catch (e) {
        console.log("[text-bucketing] 텍스트레이어 추출 실패(Gemini로 폴백):", (e as Error)?.message);
      }
    }
    const usingTextLayer = textLayerLines !== null;

    // LLM 줄 추출과 OCR은 서로 독립(둘 다 binary만 사용)이라 병렬 실행 — 순차 대비 wall-clock 대폭 단축.
    const [llmLines, ocr] = await Promise.all([
      usingTextLayer
        ? Promise.resolve(textLayerLines as OrderedLine[])
        : extractOrderedLinesFromPdf({
            pdfBuffer: binary,
            filename: sourceFileName || "report.pdf",
            usageContext: { hospitalId, feature: "extract", operationId: extractOperationId },
            // intovet: 진료 본문 이미지 박스를 못 읽는 문제 → 페이지를 렌더한 이미지로 전사(report-llm 내부 분기).
            chartKind: chartType,
          }),
      ocrConfigured
        ? runGoogleVisionOcr(binary, sourceFileType, { hospitalId, feature: "ocr", operationId: extractOperationId }).catch((ocrErr) => {
            console.error('[text-bucketing] OCR 실패 (건너뜀):', ocrErr instanceof Error ? ocrErr.message : String(ocrErr));
            return emptyOcr;
          })
        : Promise.resolve(emptyOcr),
    ]);
    // LLM/OCR 모두 일부 줄의 text 가 런타임 null 로 올 수 있음 → 빈 문자열로 정규화(downstream .trim() 널 크래시 방지).
    for (const l of llmLines) if (l.text == null) (l as { text: string }).text = "";
    ocr.rows = ocr.rows.map((r) => (r.text == null ? { ...r, text: "" } : r));
    // 추출 작업 토큰 차감(추출+OCR usage 합산 → ceil($/0.10), 병원 잔액에서 1회).
    await chargeOperationTokens(hospitalId, extractOperationId, "extract", extractProduct);
    console.log(`[text-bucketing DEBUG] llmLines count=${llmLines.length}, first3=${JSON.stringify(llmLines.slice(0, 3))}, last3=${JSON.stringify(llmLines.slice(-3))}`);
    console.log(`[text-bucketing] OCR 결과: rows=${ocr.rows.length} (ocrConfigured=${ocrConfigured}) — rows>0 이면 OCR 동작, 0이면 실패/미동작`);

    const pasteLines =
      chartType === "efriends" ? orderedLinesFromPastedChartText(chartPasteText, "efriends") : [];
    const sanitizedPdfLines = llmLines
      .map((line) => {
        let text = cleanNoise(line.text);
        if (chartType === "efriends" && text && isEfriendsPdfFooterDateTimeLine(text)) {
          text = null;
        }
        if (chartType === "efriends" && text && isEfriendsPdfFooterPageLine(text)) {
          text = null;
        }
        if (chartType === "efriends" && text && isEfriendsRepeatingPdfHeaderLine(text)) {
          text = null;
        }
        return { ...line, text: text ?? "" };
      })
      .filter((line): line is OrderedLine => Boolean(line.text));

    // LLM이 순서를 잡되, LLM이 한 페이지를 "덜 읽은"(진료를 통째 스킵한) 경우 그 페이지는 OCR로 메운다.
    // OCR은 순서가 거칠지만 누락이 없으므로, 부족한 페이지만 OCR로 교체해 완전성을 확보한다.
    // (완전 누락 페이지는 물론, 부분 누락 페이지=LLM 줄 수가 OCR의 60% 미만인 페이지도 포함)
    const cleanOcrRow = (t: string): boolean => {
      if (!t || cleanNoise(t) === null) return false;
      if (chartType === "efriends" && isEfriendsPdfFooterDateTimeLine(t)) return false;
      if (chartType === "efriends" && isEfriendsPdfFooterPageLine(t)) return false;
      if (chartType === "efriends" && isEfriendsRepeatingPdfHeaderLine(t)) return false;
      return true;
    };
    const llmCountByPage = new Map<number, number>();
    for (const l of sanitizedPdfLines) llmCountByPage.set(l.page, (llmCountByPage.get(l.page) ?? 0) + 1);
    const ocrByPage = new Map<number, OrderedLine[]>();
    for (const row of ocr.rows) {
      const t = (row.text ?? "").trim();
      if (!cleanOcrRow(t)) continue;
      const list = ocrByPage.get(row.page) ?? [];
      list.push({ page: row.page, text: t });
      ocrByPage.set(row.page, list);
    }
    // OCR 개입 최소화: OCR은 순서가 거칠어, Gemini(페이지별) 결과를 가급적 그대로 유지한다.
    // Gemini가 "사실상 통째 실패한" 페이지(아래 줄 수 미만)만 OCR로 메운다. (예전 60% 룰 → 과도 개입했음)
    const OCR_FILL_MAX_LLM_LINES = Math.max(0, Number(process.env.EXTRACT_OCR_FILL_MAX_LLM_LINES) || 2);
    const ocrReplacedPages: number[] = [];
    const allPages = [...new Set<number>([...llmCountByPage.keys(), ...ocrByPage.keys()])];
    const effectivePdfLines: OrderedLine[] = [];
    for (const page of allPages) {
      const llmCount = llmCountByPage.get(page) ?? 0;
      const ocrLines = ocrByPage.get(page) ?? [];
      // 텍스트레이어/Gemini 모두 "사실상 빈 페이지"만 OCR로 메운다(개입 최소화 — OCR 순서가 거칠어서).
      const underCovered =
        ocrLines.length >= 5 && llmCount < (usingTextLayer ? 3 : OCR_FILL_MAX_LLM_LINES);
      if (underCovered) {
        ocrReplacedPages.push(page); // 이 페이지는 LLM이 덜 읽음 → OCR로 교체(LLM 부분분 버림)
        effectivePdfLines.push(...ocrLines);
      } else {
        effectivePdfLines.push(...sanitizedPdfLines.filter((l) => l.page === page));
      }
    }
    effectivePdfLines.sort((a, b) => a.page - b.page);
    console.log(
      `[text-bucketing DEBUG] effectivePdfLines=${effectivePdfLines.length}, ocrReplacedPages(LLM 덜읽음→OCR)=${JSON.stringify(ocrReplacedPages.sort((a, b) => a - b))}`,
    );
    // 진단: 원본 추출(버켓팅 전)에 "Subjective"가 몇 개인가 = Gemini가 진료를 몇 건 뽑았나.
    // chartBody 그룹 수(subjectiveAnchored visits)와 다르면 버켓팅 문제, 같으면 추출(LLM) 문제.
    const rawSubjectiveCount = effectivePdfLines.filter((l) => /^subjective\b/i.test((l.text ?? "").trim())).length;
    console.log(`[text-bucketing DEBUG] rawSubjectiveCount(추출단계 진료수)=${rawSubjectiveCount}`);

    const sanitizedLines = [...pasteLines, ...effectivePdfLines];

    stage = "assignLinesToBuckets";
    let buckets = assignLinesToBuckets(sanitizedLines, ocr.rows, chartType);
    let physicalExamBucket: (typeof buckets)["vitals"] | undefined;
    if (chartType === "efriends") {
      const { lab: efLabLines, physicalExam } = extractEfriendsLabAndPhysicalExamBuckets(effectivePdfLines);
      if (efLabLines.length > 0) {
        buckets = { ...buckets, lab: efLabLines };
      }
      physicalExamBucket = physicalExam.length > 0 ? physicalExam : undefined;
      if (physicalExamBucket && physicalExamBucket.length > 0) {
        buckets = { ...buckets, vitals: [...buckets.vitals, ...physicalExamBucket] };
      }
    }
    const physicalExamItems =
      chartType === "efriends" ? parseEfriendsPhysicalExamItemsFromVitalsLines(buckets.vitals) : [];
    stage = "vitals";
    const mergedVitals = mergeVitalsWithPhysicalExamItems(
      parseVitalsFromLines(sanitizedLines, chartType),
      physicalExamItems,
    );

    stage = "chartBody";
    const efriendsDirectBlocks = efriendsChartBodyByDateFromBlocks(efriendsChartBlocks);
    let chartBodyByDate =
      chartType === "efriends"
        ? efriendsDirectBlocks.length > 0
          ? efriendsDirectBlocks
          : groupChartBodyByDate(buckets.chartBody, chartType)
        : groupChartBodyByDate(buckets.chartBody, chartType);
    if (
      chartType === "efriends" &&
      chartBodyByDate.length === 0 &&
      chartPasteText.trim().length > 0
    ) {
      const recovered = efriendsChartBodyByDateFromComposedPaste(chartPasteText);
      if (recovered.length > 0) {
        chartBodyByDate = recovered;
      }
    }

    const allBucketLines = Object.values(buckets).flat();
    const correctedCount = allBucketLines.filter((line) => line.corrected).length;

    stage = "groupLabLinesByDate";
    const labLineGroups = groupLabLinesByDate(buckets.lab);
    const chartTextForBasicInfo = sanitizedLines.map((line) => line.text).join("\n");
    stage = "parseBasicInfoFromText";
    const parsedBasicInfo = parseBasicInfoFromText(chartTextForBasicInfo, chartType, buckets.basicInfo);
    stage = "detectSpeciesProfile";
    const labCanonicalSpecies = detectSpeciesProfile(parsedBasicInfo.species);
    const useLabSinglePass = process.env.LAB_SINGLE_PASS === "true";
    const labItemsSource = "rules" as const;
    const labExtractError: string | null = null;
    const labItemsByDate: Array<{
      dateTime: string;
      pages: number[];
      items: Array<{
        itemName: string;
        rawItemName: string;
        valueText: string;
        unit: string | null;
        referenceRange: string | null;
        flag: "low" | "high" | "normal" | "unknown";
        page: number;
      }>;
      source: "llm" | "rules" | "empty";
      error: string | null;
    }> = [];
    // Use grouped lab lines as the single source of truth.
    // This keeps grouping deterministic and avoids cross-date spillover.
    stage = "labItems";
    for (const group of labLineGroups) {
      stage = "labItems:parse";
      const parsedRaw = parseLabItemsFromGroupLines(group.lines, chartType, { isUrinalysis: group.isUrinalysis });
      stage = "labItems:sanitize";
      const parsed = sanitizeLabItems(parsedRaw, chartType);
      const mappedItems: Array<{ itemName: string; rawItemName: string; valueText: string; unit: string | null; referenceRange: string | null; flag: LabItem["flag"]; page: number }> = [];
      for (const item of parsed) {
        const dbg = JSON.stringify({ itemName: item.itemName, valueText: item.valueText, unit: item.unit, ref: item.referenceRange, flag: item.flag }).slice(0, 300);
        stage = `labItems:canonicalize ${dbg}`;
        // 요검사(UA) 그룹은 섹션 컨텍스트로 소변 전용 이름(U-*)으로 정규화한다. rawItemName 은 원문 그대로 유지.
        //  urinalysisSectionItemName 이 null 이면 검사값 아님(채취법 Collec 등) → 드롭.
        let itemName: string;
        if (group.isUrinalysis) {
          const ua = urinalysisSectionItemName(item.itemName);
          if (ua === null) continue;
          itemName = ua;
        } else {
          itemName = canonicalizeLabItemName(item.itemName, labCanonicalSpecies);
        }
        stage = `labItems:refineFlag ${dbg}`;
        const flag = refineLabFlag(item.flag, item.valueText, item.referenceRange);
        mappedItems.push({ itemName, rawItemName: item.itemName, valueText: item.valueText, unit: canonicalizeLabUnit(item.unit), referenceRange: item.referenceRange, flag, page: item.page });
      }
      labItemsByDate.push({
        dateTime: group.dateTime,
        pages: [...new Set(group.lines.map((line) => line.page))].sort((a, b) => a - b),
        items: mappedItems,
        source: labItemsSource,
        error: labExtractError,
      });
    }

    stage = "flatLabItems";
    const flatLabItems = labItemsByDate.flatMap((group) => group.items);
    stage = "groupLabByDate";
    const labByDateForPayload = groupLabByDate(buckets.lab);
    stage = "chartDebugGroups";
    const chartDebugGroups = chartBodyByDate.map((group) => {
      const fullLines = [...(group.bodyText ? group.bodyText.split(/\r?\n/) : []), ...(group.planText ? group.planText.split(/\r?\n/) : [])]
        .map((line) => (line ?? "").trim())
        .filter(Boolean);
      return { dateTime: group.dateTime, planDetected: group.planDetected, planLineScores: buildPlanLineScores(fullLines) };
    });
    stage = "responsePayload";
    const unmatchedLabItems = labDebugEnabled
      ? (() => {
          const groupedText = labLineGroups.map((group) => ({
            dateTime: group.dateTime,
            normalized: normalizeForContains(group.lines.map((line) => line.text).join(" ")),
          }));
          return sanitizeLabItems(
            flatLabItems.map((item) => ({
              itemName: item.itemName,
              valueText: item.valueText,
              referenceRange: item.referenceRange,
            })),
            chartType,
          )
            .filter((item) => {
              const needleName = normalizeForContains(item.itemName);
              const needleValue = normalizeForContains(item.valueText);
              return !groupedText.some((group) => {
                const hasName = needleName ? group.normalized.includes(needleName) : false;
                const hasValue = needleValue ? group.normalized.includes(needleValue) : true;
                return hasName && hasValue;
              });
            })
            .map((item) => {
              const needleName = normalizeForContains(item.itemName);
              const needleValue = normalizeForContains(item.valueText);
              const hasAnyNameMatch = groupedText.some((group) =>
                needleName ? group.normalized.includes(needleName) : false,
              );
              const hasAnyValueMatch = groupedText.some((group) =>
                needleValue ? group.normalized.includes(needleValue) : false,
              );
              const candidateGroupsByName = groupedText
                .filter((group) => (needleName ? group.normalized.includes(needleName) : false))
                .map((group) => group.dateTime);
              return {
                itemName: item.itemName,
                valueText: item.valueText,
                hasAnyNameMatch,
                hasAnyValueMatch,
                candidateGroupsByName,
              };
            })
            .slice(0, 120);
        })()
      : [];

    const responsePayload = {
      chartType,
      chartTypeNotice: chartTypeNoticeFor(chartType),
      labStrategy: useLabSinglePass ? "single-pass" : "date-by-date",
      counts: {
        llm: llmLines.length,
        pasteLines: pasteLines.length,
        sanitized: sanitizedLines.length,
        removedByHardRule: llmLines.length - sanitizedPdfLines.length,
        correctedInBuckets: correctedCount,
      },
      llmText: llmLines.map((line) => line.text).join("\n"),
      sanitizedText: sanitizedLines.map((line) => line.text).join("\n"),
      bucketed: {
        basicInfo: buckets.basicInfo,
        chartBody: buckets.chartBody,
        vaccination: buckets.vaccination,
        lab: buckets.lab,
        vitals: buckets.vitals,
      },
      basicInfoParsed: parsedBasicInfo,
      chartBodyByDate,
      labByDate: labByDateForPayload,
      labItemsByDate,
      labItems: flatLabItems.map((item) => ({
        itemName: item.itemName,
        valueText: item.valueText,
        unit: item.unit,
        referenceRange: item.referenceRange,
        flag: item.flag,
        page: item.page,
      })),
      labItemsSource,
      labExtractError,
      ...(labDebugEnabled
        ? {
            debugTrace: {
              labDebugEnabled,
              llmLabLines: sanitizedLines
                .filter((line) => line.text.toLowerCase().includes("lab") || line.text.toLowerCase().includes("crp"))
                .map((line) => line.text)
                .slice(0, 120),
              ocrLabRows: ocr.rows
                .filter((row) =>
                  /(lab|name|unit|min|max|result|crp|performed by|normal|negative|positive)/i.test(row.text),
                )
                .map((row) => row.text)
                .slice(0, 200),
              bucketLabLines: buckets.lab.map((line) => line.text).slice(0, 200),
              groupedLabLines: groupLabLinesByDate(buckets.lab).map((group) => ({
                dateTime: group.dateTime,
                lines: group.lines.map((line) => line.text).slice(0, 120),
              })),
              extractedLabItems: flatLabItems.slice(0, 200).map((item) => ({
                itemName: item.itemName,
                valueText: item.valueText,
                unit: item.unit,
                flag: item.flag,
              })),
              unmatchedLabItems,
            } satisfies DebugTrace,
          }
        : {}),
      ocrDebug: ocr.debug ?? null,
      chartDebug: {
        groups: chartDebugGroups,
      },
    };

    stage = "vaccination";
    const vaccinationRecords = parseVaccinationRecordsFromBucketLines(
      buckets.vaccination.map((line) => ({ text: line.text ?? "" })),
    );
    stage = "afterVaccination";
    const responsePayloadWithVaccination = { ...responsePayload, vaccinationRecords };

    console.log("[text-bucketing] saveParseRun 시작: hospitalId=%s chartBodyByDate=%d labGroups=%d", hospitalId, responsePayload.chartBodyByDate.length, responsePayload.labItemsByDate.length);
    stage = "saveParseRun";
    const saved = await saveParseRun({
      fileName: sourceFileName || "report.pdf",
      chartType,
      provider: process.env.LLM_PROVIDER ?? "openai",
      model:
        (process.env.LLM_PROVIDER ?? "openai") === "gemini"
          ? process.env.GEMINI_REPORT_MODEL ?? "gemini-2.5-flash"
          : getOpenAiOrderedLinesModel(),
      parserVersion: "text-bucket-v1",
      rawPayload: { ...responsePayloadWithVaccination, sourceStorage: { bucket: sourceStorageBucket, paths: sourceStoragePaths, product: extractProduct } },
      fileBuffer: binary,
      chartBodyByDate: responsePayload.chartBodyByDate.map((group) => ({
        dateTime: group.dateTime,
        bodyText: group.bodyText,
        planText: group.planText,
        planDetected: group.planDetected,
      })),
      labItemsByDate: responsePayload.labItemsByDate.map((group) => ({
        dateTime: group.dateTime,
        items: group.items.map((item) => ({
          itemName: item.itemName,
          rawItemName: item.rawItemName,
          valueText: item.valueText,
          unit: item.unit,
          referenceRange: item.referenceRange,
          flag: item.flag,
        })),
      })),
      vaccinationRecords,
      vitals: mergedVitals,
      physicalExamItems,
      basicInfoParsed: responsePayload.basicInfoParsed,
      hospitalId,
      replaceRunId,
    });

    console.log("[text-bucketing] saveParseRun 완료: runId=%s friendlyId=%s", saved.runId, saved.friendlyId);

    // 추출/OCR usage 를 방금 만든 run 에 귀속 — 토큰 내역에서 추출이 해당 작업(run)에 묶이도록.
    // (추출 시점엔 run 이 아직 없어 run_id 없이 기록됨 → 생성 후 backfill. best-effort)
    if (saved.runId) {
      try {
        await getChartPgPool().query(
          `UPDATE billing.llm_usage SET run_id = $1::uuid WHERE operation_id = $2::uuid AND run_id IS NULL`,
          [saved.runId, extractOperationId],
        );
      } catch (e) {
        console.warn("[text-bucketing] extract usage run_id backfill 실패(무시):", e instanceof Error ? e.message : String(e));
      }
    }

    // fire-and-forget: AI Assessment generation (does not block response)
    generateAndSaveAssessment(saved.runId, {
      chartBodyByDate: responsePayload.chartBodyByDate.map((g) => ({
        dateTime: g.dateTime,
        bodyText: g.bodyText,
        planText: g.planText,
      })),
      labItemsByDate: responsePayload.labItemsByDate.map((g) => ({
        dateTime: g.dateTime,
        items: g.items.map((it) => ({
          itemName: it.itemName,
          valueText: it.valueText,
          flag: it.flag,
        })),
      })),
    }).catch((err: unknown) => {
      console.error("[text-bucketing] AI Assessment generation failed:", err);
    });

    const debugPayload = {
      llmLineCount: llmLines.length,
      ocrRowCount: ocr.rows.length,
      llmPageCount: llmCountByPage.size,
      ocrReplacedPageCount: ocrReplacedPages.length,
      effectivePdfLineCount: effectivePdfLines.length,
      sanitizedLineCount: sanitizedLines.length,
      bucketSizes: {
        basicInfo: buckets.basicInfo.length,
        chartBody: buckets.chartBody.length,
        lab: buckets.lab.length,
        vitals: buckets.vitals.length,
      },
      effectiveHead: effectivePdfLines.slice(0, 10).map((l) => `p${l.page}: ${l.text}`),
      bucketLines: {
        basicInfo: buckets.basicInfo.map((l) => `p${l.page}: ${l.text}`),
        vitals: buckets.vitals.map((l) => `p${l.page}: ${l.text}`),
        chartBody: buckets.chartBody.map((l) => `p${l.page}: ${l.text}`),
        lab: buckets.lab.map((l) => `p${l.page}: ${l.text}`),
      },
    };
    try {
      writeFileSync("C:/Users/tj900/Downloads/bucket-debug.json", JSON.stringify(debugPayload, null, 2), "utf8");
    } catch (_) { /* non-fatal */ }

    return Response.json({
      runId: saved.runId,
      friendlyId: saved.friendlyId,
      _debug: debugPayload,
    });
  } catch (error) {
    const openAiDetails = extractOpenAiErrorDetails(error);
    if (openAiDetails) {
      console.error("[text-bucketing] OpenAI API error:", JSON.stringify(openAiDetails));
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    const stack = error instanceof Error && error.stack ? error.stack : "";
    console.error("[text-bucketing] pipeline failed:", stack || message);
    return Response.json(
      {
        error: `Text bucket pipeline failed: ${message}`,
        // 디버그(임시): 정확한 크래시 위치 확인용 — 잡고 나면 제거.
        stage: stage === "saveParseRun" ? `saveParseRun:${saveSubStage}` : stage,
        stack: stack.split("\n").slice(0, 8).join("\n"),
        ...(exposeOpenAiErrorDetailsInResponse() && openAiDetails ? { openAiError: openAiDetails } : {}),
      },
      { status: 500 },
    );
  }
}

// Export internal helpers for reuse in storage pipeline.
export {
  cleanNoise,
  groupLabLinesByDate,
  parseLabItemsFromGroupLines,
  sanitizeLabItems,
  parseBasicInfoFromText,
  groupChartBodyByDate,
  parsePlanRows,
  parseVitalsFromLines,
  parseEfriendsPhysicalExamItemsFromVitalsLines,
  mergeVitalsWithPhysicalExamItems,
  saveParseRun,
};
export { isVisitContextLine } from "@/lib/text-bucketing/chart-dates";
export { minimalOcrCorrection } from "@/lib/text-bucketing/ocr-line-correction";
