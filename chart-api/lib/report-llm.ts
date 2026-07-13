import OpenAI, { APIError, RateLimitError } from 'openai';
import { toFile } from 'openai/uploads';
import { GoogleGenAI, Type } from '@google/genai';
import { getLlmProvider } from '@/lib/llm-provider';
import { getPdfPageCount, slicePdfPages, extractPageJpegsFromImagePdf } from '@/lib/pdf-slice-pages';
import { renderPdfPagesToJpegs } from '@/lib/pdf-render-pages';
import { withGenAiUsage, withOpenAiResponsesUsage } from '@/lib/billing/wrap-clients';
import type { UsageContext } from '@/lib/billing/usage-log';
import type { ChartKind } from '@/lib/chart-app/chart-kind';

type SoapByDate = {
  date: string;
  rowCount: number;
  pages: number[];
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  unclassified: string;
};

type LabItem = {
  itemName: string;
  valueText: string;
  unit: string | null;
  referenceRange: string | null;
  flag: 'low' | 'high' | 'normal' | 'unknown';
  page: number;
};

type LabByDate = {
  date: string;
  pages: number[];
  items: LabItem[];
};

type PacsByDate = {
  date: string;
  rowCount: number;
  pages: number[];
  filenames: string[];
};

export type StructuredReport = {
  labDate: string | null;
  soapByDate: SoapByDate[];
  labItemsByDate: LabByDate[];
  pacsByDate: PacsByDate[];
};

export type OrderedLine = {
  page: number;
  text: string;
};

const JSON_RETRY_LIMIT = 2;
const LONG_PDF_BYTES_THRESHOLD = 8 * 1024 * 1024;
const ENABLE_ORDERED_LINES_CHUNK_MODE = process.env.ORDERED_LINES_CHUNK_MODE === 'true';
// 폴백: 큰 PDF는 페이지별(1장씩) 독립 전사 → 페이지 순서대로 병합. 겹침 0(중복 오염 방지).
// - 1장은 토큰 한도에 안 걸려 잘림 없음 + "비슷한 진료 통째 스킵" 방지 + 순서 보존.
// - 경계 페이지 누락은 OCR 백스톱(route 병합)이 사실상-빈-페이지만 메워 보강.
// 둘 다 env로 무중단 튜닝 가능(EXTRACT_PAGE_RANGE_SIZE / EXTRACT_PAGE_RANGE_OVERLAP).
const PAGE_RANGE_SIZE = Math.max(1, Number(process.env.EXTRACT_PAGE_RANGE_SIZE) || 1);
const PAGE_RANGE_OVERLAP = Math.max(0, Number(process.env.EXTRACT_PAGE_RANGE_OVERLAP) || 0);

// 추출 전사 시 글자를 반드시 라틴(영어)·아라비아 숫자·한글로만 출력하도록 강제하는 공통 지시.
// 스캔 PDF OCR/LLM이 그리스 대문자(Μ/Ο/Κ/Ν)·키릴·아랍 문자를 라틴 동형문자 자리에 넣으면
// 다운스트림 검사항목 파서가 단위/이름/값을 못 읽어 행을 통째로 떨군다(예: ΜΟΝΟ, Μ/μL, 값 Ο).
// 추출 시점에서 라틴으로 강제해 근본 차단한다. 모든 추출 프롬프트(단일패스/페이지범위, Gemini·OpenAI)에 부착.
const SCRIPT_INSTRUCTION =
  " SCRIPT RULES (critical): Output every character using ONLY Latin (English) letters, Arabic numerals (0-9), and Korean (Hangul). NEVER substitute Greek, Cyrillic, Arabic, or other non-Latin letters for visually similar Latin letters or digits. For example, write 'MONO' not 'ΜΟΝΟ', 'K/uL' not 'Κ/μL', 'M/uL' not 'Μ/μL', 'BASO' not 'ΒΑSΟ', and the digit '0' (zero) not the letter 'O'/'Ο'. Use 'u' for the micro unit (e.g., 'K/uL', 'ug/dL'). Transcribe Korean exactly as printed in Hangul.";

export type ReconstructedPlanRow = {
  code: string;
  name: string;
  qty: string;
  unit: string;
  day: string;
  total: string;
  route: string;
};

/**
 * Plan 표가 줄 추출에서 흩어진 경우(긴 항목명이 줄바꿈되며 다음 행 코드와 섞임)를
 * Gemini 로 표 행을 구조화 복원한다. 실패하면 null(호출부에서 정규식 파서로 폴백).
 * 텍스트만 입력(이미지 불필요) — 괄호 짝맞춤·의미로 쪼개진 이름을 올바른 행에 합쳐준다.
 */
export async function reconstructPlanRowsFromText(planText: string): Promise<ReconstructedPlanRow[] | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  const text = (planText ?? '').trim();
  if (!apiKey || !text) return null;
  const model = process.env.GEMINI_REPORT_MODEL ?? 'gemini-2.5-flash';
  const client = new GoogleGenAI({ apiKey });
  const prompt = [
    '수의 EMR 의 Plan(처방/치료) 표 텍스트다. 줄 단위로 추출돼 긴 항목명이 여러 줄로 쪼개지고 다음 행의 코드와 섞여 들어왔다.',
    '컬럼: 코드 | 항목명 | 수량 | 일투 | 일수 | 총투 | Route | Dose.',
    '규칙:',
    '- 각 행은 코드로 시작한다(예: EVENT002, DBD002, AAA001, WC00483).',
    '- 항목명이 여러 줄로 줄바꿈될 수 있다. 쪼개진 이름 조각을 하나로 합쳐라. 조각이 "다음 행 코드로 시작하는 줄"에 섞여 있어도, 괄호 짝맞춤·의미로 올바른 행에 붙여라.',
    '  예: "건강검진(CBC+Chemistry+전해" + "질+방사선+초음파)" 는 한 이름이다.',
    '- 텍스트에 있는 값만 쓰고, 없는 값은 빈 문자열로 둔다(추측 금지).',
    'strict JSON 으로만 답하라.',
  ].join('\n');
  try {
    const res = await client.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: `${prompt}\n\n[표 텍스트]\n${text}` }] }],
      config: {
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 },
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            rows: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  code: { type: Type.STRING },
                  name: { type: Type.STRING },
                  qty: { type: Type.STRING },
                  unit: { type: Type.STRING },
                  day: { type: Type.STRING },
                  total: { type: Type.STRING },
                  route: { type: Type.STRING },
                },
                required: ['code', 'name'],
              },
            },
          },
          required: ['rows'],
        },
      },
    });
    const out = res.text;
    if (!out) return null;
    const parsed = JSON.parse(out) as { rows?: ReconstructedPlanRow[] };
    const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
    const cleaned = rows.filter(
      (r) => r && typeof r.code === 'string' && typeof r.name === 'string' && (r.code.trim() || r.name.trim()),
    );
    return cleaned.length > 0 ? cleaned : null;
  } catch {
    return null;
  }
}
const MAX_PAGE_COUNT = 300;
const RANGE_RETRY_LIMIT = 1;

/** Fallback merge: preserve (page, chunk order, line index in chunk). */
type TaggedOrderedLine = OrderedLine & { rangeStart: number; seqInRange: number };

function summarizeOutputForLog(output: string) {
  const compact = output.replace(/\s+/g, ' ').trim();
  return {
    outputLength: output.length,
    head: compact.slice(0, 240),
    tail: compact.slice(Math.max(0, compact.length - 240)),
  };
}

function parseJsonWithContext<T>(raw: string, context: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    const meta = summarizeOutputForLog(raw);
    const reason = error instanceof Error ? error.message : 'unknown parse error';
    throw new Error(
      `${context}: ${reason} (len=${meta.outputLength}, head="${meta.head}", tail="${meta.tail}")`,
    );
  }
}

function mergeChunkedOrderedLines(
  payload: { chunks?: Array<{ lines?: OrderedLine[] }> } | { lines?: OrderedLine[] },
): OrderedLine[] {
  if ('lines' in payload && Array.isArray(payload.lines)) {
    return payload.lines.filter((line) => line.text?.trim().length > 0);
  }
  const chunks = 'chunks' in payload && Array.isArray(payload.chunks) ? payload.chunks : [];
  const merged: OrderedLine[] = [];
  for (const chunk of chunks) {
    const lines = Array.isArray(chunk?.lines) ? chunk.lines : [];
    for (const line of lines) {
      if (line?.text?.trim().length > 0) merged.push(line);
    }
  }
  return merged;
}

/**
 * 페이지-범위 전사 결과 병합.
 *
 * ★텍스트가 같다는 이유로 줄을 지우지 않는다. 차트에는 "- P/E", "- 혈액검사", "Tx)",
 *   ": famo 0,5 iv bid" 처럼 **날짜마다 정상적으로 반복되는 줄**이 많다. 예전에는
 *   `key = 페이지+텍스트` 로 dedupe 해서, 한 페이지에 두 진료가 걸치면 뒤 진료의 반복 줄이
 *   통째로 사라졌다(진료 본문이 조금씩 비던 원인).
 *
 * 같은 페이지가 여러 range 에서 전사되는 경우(겹침 overlap>0, 또는 재시도)에만 중복이 생기므로,
 * 그때는 가장 많이 뽑아낸 range 하나만 채택한다(줄 단위로 섞지 않는다 — 순서가 꼬인다).
 */
function mergeFallbackTaggedLines(tagged: TaggedOrderedLine[]): OrderedLine[] {
  const byPage = new Map<number, Map<number, TaggedOrderedLine[]>>();
  for (const row of tagged) {
    const t = row.text?.trim();
    if (!t) continue;
    const byRange = byPage.get(row.page) ?? new Map<number, TaggedOrderedLine[]>();
    const list = byRange.get(row.rangeStart) ?? [];
    list.push({ ...row, text: t });
    byRange.set(row.rangeStart, list);
    byPage.set(row.page, byRange);
  }

  const out: OrderedLine[] = [];
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    const byRange = byPage.get(page)!;
    let best: TaggedOrderedLine[] = [];
    let bestStart = Number.POSITIVE_INFINITY;
    for (const [rangeStart, lines] of byRange) {
      // 더 많이 읽어낸 range 우선(같으면 앞선 range).
      if (lines.length > best.length || (lines.length === best.length && rangeStart < bestStart)) {
        best = lines;
        bestStart = rangeStart;
      }
    }
    for (const row of [...best].sort((a, b) => a.seqInRange - b.seqInRange)) {
      out.push({ page: row.page, text: row.text });
    }
  }
  return out;
}
async function detectPdfPageCountWithGemini(params: {
  client: GoogleGenAI;
  model: string;
  pdfBuffer: Buffer;
}): Promise<number> {
  const response = await params.client.models.generateContent({
    model: params.model,
    contents: [
      {
        role: 'user',
        parts: [
          { text: 'Return only JSON: {"pageCount": number}. Count total pages in this PDF.' },
          {
            inlineData: {
              mimeType: 'application/pdf',
              data: params.pdfBuffer.toString('base64'),
            },
          },
        ],
      },
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: { pageCount: { type: Type.NUMBER } },
        required: ['pageCount'],
      },
    },
  });
  const output = response.text;
  if (!output) throw new Error('Gemini page count response empty.');
  const parsed = parseJsonWithContext<{ pageCount?: number }>(output, 'Gemini page count parse failed');
  const n = Number(parsed.pageCount ?? 0);
  if (!Number.isFinite(n) || n < 1) throw new Error('Gemini page count invalid.');
  return Math.min(MAX_PAGE_COUNT, Math.floor(n));
}

async function resolvePdfPageCountForOrderedLines(
  pdfBuffer: Buffer,
  client: GoogleGenAI,
  model: string,
): Promise<number> {
  try {
    const n = await getPdfPageCount(pdfBuffer);
    if (Number.isFinite(n) && n >= 1) return Math.min(MAX_PAGE_COUNT, n);
  } catch {
    /* invalid or unsupported PDF for pdf-lib */
  }
  return detectPdfPageCountWithGemini({ client, model, pdfBuffer });
}

/**
 * One Gemini call with JPEG images instead of a PDF slice.
 */
async function extractOrderedLinesFromGeminiImageSlice(params: {
  client: GoogleGenAI;
  model: string;
  images: Buffer[];
  /**
   * true 면 "페이지를 통째 렌더한 이미지"를 받는 모드(인투벳 등). 이 이미지엔 진료 본문뿐 아니라
   * X-ray·초음파 같은 실제 사진이 섞일 수 있으므로, "보이는 글자만 그대로 전사, 사진 내용은
   * 해석·묘사·진단·창작 금지"를 프롬프트에 명시한다.
   */
  transcribeVisibleTextOnly?: boolean;
}): Promise<OrderedLine[]> {
  const images = params.images.filter((b) => b.length >= 10_000);
  if (images.length === 0) return [];

  const visibleTextOnlyClause = params.transcribeVisibleTextOnly
    ? ' These are rendered page images and MAY contain photographs such as X-ray, ultrasound, or other clinical images. Transcribe ONLY the text characters that are actually printed/visible on the page. Do NOT describe, interpret, diagnose, caption, or invent any content from photographs or images — if a region is a photo with no printed text, output nothing for it.'
    : '';

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= RANGE_RETRY_LIMIT; attempt += 1) {
    try {
      const response = await params.client.models.generateContent({
        model: params.model,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: 'Read this veterinary PDF from its first page through its last page in visual reading order. Transcribe EVERY visible text line verbatim — do NOT skip, summarize, merge, or omit any line, even if its content repeats or looks similar to another visit/section. Return strict JSON only. Do not bucket or classify. Number `page` starting at 1 for the first page of this file through the last page. Keep original line texts. The lines array order MUST match visual reading order (top-to-bottom, then next column if any). For any TABLE (e.g., a treatment/Plan table or a lab result table), output each table ROW as ONE single line containing all cells of that row left-to-right separated by single spaces; never split a single row across multiple lines, and never read a table column-by-column.' + visibleTextOnlyClause + SCRIPT_INSTRUCTION,
              },
              ...images.map((buf) => ({
                inlineData: { mimeType: 'image/jpeg' as const, data: buf.toString('base64') },
              })),
            ],
          },
        ],
        config: {
          responseMimeType: 'application/json',
          maxOutputTokens: 65536,
          thinkingConfig: { thinkingBudget: 0 },
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              lines: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    page: { type: Type.NUMBER },
                    text: { type: Type.STRING },
                  },
                  required: ['page', 'text'],
                },
              },
            },
            required: ['lines'],
          },
        },
      });
      const output = response.text;
      if (!output) return [];
      const parsed = parseJsonWithContext<{ lines?: OrderedLine[] }>(
        output,
        `Gemini image-slice parse (attempt ${attempt + 1})`,
      );
      const lines = Array.isArray(parsed.lines) ? parsed.lines : [];
      return lines.filter((x) => x?.text?.trim().length > 0 && Number.isFinite(Number(x.page)));
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastError ?? new Error('Gemini image-slice ordered-lines parse failed.');
}

/** One Gemini call on a PDF slice; `page` in output is local 1..N, remapped by caller. */
async function extractOrderedLinesFromGeminiPdfSlice(params: {
  client: GoogleGenAI;
  model: string;
  pdfBuffer: Buffer;
}): Promise<OrderedLine[]> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= RANGE_RETRY_LIMIT; attempt += 1) {
    const response = await params.client.models.generateContent({
      model: params.model,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: 'Read this veterinary PDF from its first page through its last page in visual reading order. Transcribe EVERY visible text line verbatim — do NOT skip, summarize, merge, or omit any line, even if its content repeats or looks similar to another visit/section. Return strict JSON only. Do not bucket or classify. Number `page` starting at 1 for the first page of this file through the last page. Keep original line texts. The lines array order MUST match visual reading order (top-to-bottom, then next column if any). For any TABLE (e.g., a treatment/Plan table or a lab result table), output each table ROW as ONE single line containing all cells of that row left-to-right separated by single spaces; never split a single row across multiple lines, and never read a table column-by-column.' + SCRIPT_INSTRUCTION,
            },
            {
              inlineData: {
                mimeType: 'application/pdf',
                data: params.pdfBuffer.toString('base64'),
              },
            },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        // 슬라이스 JSON이 잘리면 그 페이지들의 진료가 통째로 누락된다.
        // 출력 토큰을 크게 잡고(2.5-flash 최대 65536), thinking은 출력 토큰을 잠식하므로 끈다.
        maxOutputTokens: 65536,
        thinkingConfig: { thinkingBudget: 0 },
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            lines: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  page: { type: Type.NUMBER },
                  text: { type: Type.STRING },
                },
                required: ['page', 'text'],
              },
            },
          },
          required: ['lines'],
        },
      },
    });
    const output = response.text;
    if (!output) return [];
    try {
      const parsed = parseJsonWithContext<{ lines?: OrderedLine[] }>(
        output,
        `Gemini slice parse failed (attempt ${attempt + 1})`,
      );
      const lines = Array.isArray(parsed.lines) ? parsed.lines : [];
      return lines.filter((x) => x?.text?.trim().length > 0 && Number.isFinite(Number(x.page)));
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError ?? new Error('Gemini slice ordered-lines parse failed.');
}

export async function extractStructuredReportFromPdf(params: {
  pdfBuffer: Buffer;
  filename: string;
}): Promise<StructuredReport> {
  const provider = getLlmProvider();
  if (provider === 'gemini') {
    return extractStructuredReportFromPdfWithGemini(params);
  }
  return extractStructuredReportFromPdfWithOpenAi(params);
}

/**
 * Model for PDF ordered-lines via Responses API + `input_file` + json_schema.
 */
export function getOpenAiOrderedLinesModel(): string {
  return (
    process.env.OPENAI_ORDERED_LINES_MODEL?.trim() ||
    process.env.OPENAI_LAB_MODEL?.trim() ||
    'gpt-4.1'
  );
}

export async function extractOrderedLinesFromPdf(params: {
  pdfBuffer: Buffer;
  filename: string;
  /** 페이지-범위 fallback 청크 크기. plusvet 등 반복 진료로 스킵 위험이 큰 차트는 1(페이지당). 기본 10. */
  pageRangeSize?: number;
  /** 과금 사용량 적재용 컨텍스트(병원/run). */
  usageContext?: UsageContext;
  /**
   * 차트 종류. intovet 은 진료 본문을 "이미지 박스"로 넣어, 텍스트레이어가 있는 페이지의 박스를
   * PDF 직송으로는 못 읽는다 → 페이지를 통째 렌더한 이미지로 전사한다(extractOrderedLinesFromPdfWithGemini 참고).
   */
  chartKind?: ChartKind;
}): Promise<OrderedLine[]> {
  const provider = getLlmProvider();
  if (provider === 'gemini') {
    return extractOrderedLinesFromPdfWithGemini(params);
  }
  return extractOrderedLinesFromPdfWithOpenAi(params);
}

async function extractStructuredReportFromPdfWithOpenAi(params: {
  pdfBuffer: Buffer;
  filename: string;
}): Promise<StructuredReport> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured.');
  }

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_LAB_MODEL ?? 'gpt-4.1-mini';

  const uploadFile = await toFile(
    new Uint8Array(params.pdfBuffer),
    params.filename || 'report.pdf',
    { type: 'application/pdf' },
  );

  const file = await client.files.create({
    file: uploadFile,
    purpose: 'user_data',
  });

  const response = await client.responses.create({
    model,
    input: [
      {
        role: 'system',
        content:
          'You are a veterinary EMR report parser. Read the PDF in visual document order and return only strict JSON.',
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: 'Parse this veterinary chart PDF into 3 sections by date: SOAP text, Lab Examination items, PACS Image filenames. Ignore non-clinical dates such as Printed/Birth/DOB. Prefer clinical visit dates. Return only JSON.',
          },
          {
            type: 'input_file',
            file_id: file.id,
          },
        ],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'structured_report',
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            labDate: { type: ['string', 'null'] },
            soapByDate: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  date: { type: 'string' },
                  rowCount: { type: 'number' },
                  pages: { type: 'array', items: { type: 'number' } },
                  subjective: { type: 'string' },
                  objective: { type: 'string' },
                  assessment: { type: 'string' },
                  plan: { type: 'string' },
                  unclassified: { type: 'string' },
                },
                required: [
                  'date',
                  'rowCount',
                  'pages',
                  'subjective',
                  'objective',
                  'assessment',
                  'plan',
                  'unclassified',
                ],
              },
            },
            labItemsByDate: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  date: { type: 'string' },
                  pages: { type: 'array', items: { type: 'number' } },
                  items: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        itemName: { type: 'string' },
                        valueText: { type: 'string' },
                        unit: { type: ['string', 'null'] },
                        referenceRange: { type: ['string', 'null'] },
                        flag: {
                          type: 'string',
                          enum: ['low', 'high', 'normal', 'unknown'],
                        },
                        page: { type: 'number' },
                      },
                      required: [
                        'itemName',
                        'valueText',
                        'unit',
                        'referenceRange',
                        'flag',
                        'page',
                      ],
                    },
                  },
                },
                required: ['date', 'pages', 'items'],
              },
            },
            pacsByDate: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  date: { type: 'string' },
                  rowCount: { type: 'number' },
                  pages: { type: 'array', items: { type: 'number' } },
                  filenames: { type: 'array', items: { type: 'string' } },
                },
                required: ['date', 'rowCount', 'pages', 'filenames'],
              },
            },
          },
          required: ['labDate', 'soapByDate', 'labItemsByDate', 'pacsByDate'],
        },
      },
    },
  });

  if (!response.output_text) {
    throw new Error('LLM returned empty structured output.');
  }

  const parsed = JSON.parse(response.output_text) as StructuredReport;
  return parsed;
}

async function extractStructuredReportFromPdfWithGemini(params: {
  pdfBuffer: Buffer;
  filename: string;
}): Promise<StructuredReport> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured.');
  }

  const model = process.env.GEMINI_REPORT_MODEL ?? 'gemini-2.5-flash';
  const client = new GoogleGenAI({ apiKey });
  const prompt = [
    'You are a veterinary EMR report parser.',
    'Parse this PDF into strict JSON only.',
    'Sections:',
    '- soapByDate: date, rowCount, pages, subjective, objective, assessment, plan, unclassified',
    '- labItemsByDate: grouped by date with itemName/valueText/unit/referenceRange/flag/page',
    '- pacsByDate: grouped by date with filenames',
    '- labDate: blood test date if available else null',
    'Ignore non-clinical dates such as Printed/Birth/DOB and prefer visit dates.',
  ].join('\n');

  const response = await client.models.generateContent({
    model,
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: 'application/pdf',
              data: params.pdfBuffer.toString('base64'),
            },
          },
        ],
      },
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          labDate: { type: Type.STRING, nullable: true },
          soapByDate: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                date: { type: Type.STRING },
                rowCount: { type: Type.NUMBER },
                pages: { type: Type.ARRAY, items: { type: Type.NUMBER } },
                subjective: { type: Type.STRING },
                objective: { type: Type.STRING },
                assessment: { type: Type.STRING },
                plan: { type: Type.STRING },
                unclassified: { type: Type.STRING },
              },
              required: [
                'date',
                'rowCount',
                'pages',
                'subjective',
                'objective',
                'assessment',
                'plan',
                'unclassified',
              ],
            },
          },
          labItemsByDate: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                date: { type: Type.STRING },
                pages: { type: Type.ARRAY, items: { type: Type.NUMBER } },
                items: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      itemName: { type: Type.STRING },
                      valueText: { type: Type.STRING },
                      unit: { type: Type.STRING, nullable: true },
                      referenceRange: { type: Type.STRING, nullable: true },
                      flag: {
                        type: Type.STRING,
                        enum: ['low', 'high', 'normal', 'unknown'],
                      },
                      page: { type: Type.NUMBER },
                    },
                    required: [
                      'itemName',
                      'valueText',
                      'unit',
                      'referenceRange',
                      'flag',
                      'page',
                    ],
                  },
                },
              },
              required: ['date', 'pages', 'items'],
            },
          },
          pacsByDate: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                date: { type: Type.STRING },
                rowCount: { type: Type.NUMBER },
                pages: { type: Type.ARRAY, items: { type: Type.NUMBER } },
                filenames: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
              required: ['date', 'rowCount', 'pages', 'filenames'],
            },
          },
        },
        required: ['labDate', 'soapByDate', 'labItemsByDate', 'pacsByDate'],
      },
    },
  });

  const output = response.text;
  if (!output) {
    throw new Error('Gemini returned empty structured output.');
  }
  return parseJsonWithContext<StructuredReport>(output, 'Gemini structured report JSON parse failed');
}

function shouldUseOpenAiPageRangeFallback(error: unknown): boolean {
  if (error instanceof RateLimitError) return true;
  if (error instanceof APIError && error.status === 429) return true;
  const msg = error instanceof Error ? error.message : String(error);
  if (/TPM|tokens per min|rate limit|request too large|too large for/i.test(msg)) return true;
  // Truncated JSON = model hit max output tokens → smaller page-range slices are safer
  if (/JSON parse failed|Unterminated string|unexpected token/i.test(msg)) return true;
  return false;
}

async function openAiOrderedLinesFromPdfBuffer(params: {
  client: OpenAI;
  model: string;
  pdfBuffer: Buffer;
  filename: string;
  useChunkMode: boolean;
}): Promise<OrderedLine[]> {
  const { client, model, pdfBuffer, filename, useChunkMode } = params;
  const uploadFile = await toFile(new Uint8Array(pdfBuffer), filename || 'report.pdf', {
    type: 'application/pdf',
  });
  const file = await client.files.create({ file: uploadFile, purpose: 'user_data' });

  const basePrompt =
    'Read this veterinary PDF from first page to last page in visual order and output only ordered lines. Do not bucket, classify, summarize, or drop text.' +
    SCRIPT_INSTRUCTION;

  try {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= JSON_RETRY_LIMIT; attempt += 1) {
      const strictHint =
        attempt === 0
          ? ''
          : '\nJSON only. Output MUST be valid JSON with properly escaped quotes/newlines.';
      const useChunkEnvelope = useChunkMode && attempt >= 1;
      const response = await client.responses.create({
        model,
        input: [
          {
            role: 'system',
            content: 'Extract plain document lines in visual reading order. Return strict JSON only.',
          },
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: useChunkEnvelope
                  ? `${basePrompt}\nFor stability on large documents, split output into multiple chunks: chunks[].lines[].${strictHint}`
                  : `${basePrompt}${strictHint}`,
              },
              { type: 'input_file', file_id: file.id },
            ],
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: useChunkEnvelope ? 'ordered_lines_chunked' : 'ordered_lines',
            schema: useChunkEnvelope
              ? {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    chunks: {
                      type: 'array',
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                          lines: {
                            type: 'array',
                            items: {
                              type: 'object',
                              additionalProperties: false,
                              properties: {
                                page: { type: 'number' },
                                text: { type: 'string' },
                              },
                              required: ['page', 'text'],
                            },
                          },
                        },
                        required: ['lines'],
                      },
                    },
                  },
                  required: ['chunks'],
                }
              : {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    lines: {
                      type: 'array',
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                          page: { type: 'number' },
                          text: { type: 'string' },
                        },
                        required: ['page', 'text'],
                      },
                    },
                  },
                  required: ['lines'],
                },
          },
        },
      });

      const output = response.output_text;
      if (!output) return [];
      try {
        const parsed = parseJsonWithContext<{ lines?: OrderedLine[]; chunks?: Array<{ lines?: OrderedLine[] }> }>(
          output,
          `OpenAI ordered-lines JSON parse failed (attempt ${attempt + 1})`,
        );
        return mergeChunkedOrderedLines(parsed);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }
    throw lastError ?? new Error('OpenAI ordered-lines parse failed.');
  } finally {
    try {
      await client.files.delete(file.id);
    } catch {
      /* ignore */
    }
  }
}

async function openAiOrderedLinesByPdfPageRanges(params: {
  client: OpenAI;
  model: string;
  pdfBuffer: Buffer;
  filename: string;
}): Promise<OrderedLine[]> {
  const pageCount = await getPdfPageCount(params.pdfBuffer);
  const rawSize = process.env.OPENAI_ORDERED_LINES_RANGE_PAGE_SIZE?.trim();
  const parsedSize = rawSize ? parseInt(rawSize, 10) : NaN;
  const rangeSize =
    Number.isFinite(parsedSize) && parsedSize > 0 ? Math.min(50, parsedSize) : 5;
  const rawDelay = process.env.OPENAI_ORDERED_LINES_INTER_CHUNK_DELAY_MS?.trim();
  const delayMs = Math.max(0, parseInt(rawDelay ?? '12000', 10) || 0);

  const baseName = (params.filename || 'report.pdf').replace(/\.pdf$/i, '') || 'report';
  const merged: TaggedOrderedLine[] = [];

  for (let start = 1; start <= pageCount; start += rangeSize) {
    const end = Math.min(pageCount, start + rangeSize - 1);
    const pagesInSlice = end - start + 1;
    const slice = await slicePdfPages(params.pdfBuffer, start, end);
    const sliceFile = `${baseName}_p${start}-${end}.pdf`;
    const lines = await openAiOrderedLinesFromPdfBuffer({
      client: params.client,
      model: params.model,
      pdfBuffer: slice,
      filename: sliceFile,
      useChunkMode: false,
    });
    lines.forEach((line, seqInRange) => {
      const t = line.text?.trim();
      if (!t) return;
      const local = Math.floor(Number(line.page));
      if (!Number.isFinite(local)) return;
      const globalPage =
        local >= 1 && local <= pagesInSlice
          ? start - 1 + local
          : Math.min(end, Math.max(start, local));
      merged.push({ page: globalPage, text: t, rangeStart: start, seqInRange });
    });
    if (end < pageCount && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return mergeFallbackTaggedLines(merged);
}

async function extractOrderedLinesFromPdfWithOpenAi(params: {
  pdfBuffer: Buffer;
  filename: string;
  usageContext?: UsageContext;
}): Promise<OrderedLine[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured.');
  }

  // responses.create 를 감싸 모든 ordered-lines sub-call usage 자동 적재.
  const client = withOpenAiResponsesUsage(new OpenAI({ apiKey }), { feature: 'extract', ...params.usageContext });
  const model = getOpenAiOrderedLinesModel();
  const useChunkMode = ENABLE_ORDERED_LINES_CHUNK_MODE && params.pdfBuffer.length >= LONG_PDF_BYTES_THRESHOLD;

  if (process.env.OPENAI_ORDERED_LINES_FORCE_PAGE_RANGES?.trim().toLowerCase() === 'true') {
    return openAiOrderedLinesByPdfPageRanges({
      client,
      model,
      pdfBuffer: params.pdfBuffer,
      filename: params.filename || 'report.pdf',
    });
  }

  try {
    return await openAiOrderedLinesFromPdfBuffer({
      client,
      model,
      pdfBuffer: params.pdfBuffer,
      filename: params.filename || 'report.pdf',
      useChunkMode,
    });
  } catch (error) {
    if (!shouldUseOpenAiPageRangeFallback(error)) throw error;
    return openAiOrderedLinesByPdfPageRanges({
      client,
      model,
      pdfBuffer: params.pdfBuffer,
      filename: params.filename || 'report.pdf',
    });
  }
}

async function extractOrderedLinesFromPdfWithGemini(params: {
  pdfBuffer: Buffer;
  filename: string;
  pageRangeSize?: number;
  usageContext?: UsageContext;
  chartKind?: ChartKind;
}): Promise<OrderedLine[]> {
  const pageRangeSize = params.pageRangeSize && params.pageRangeSize > 0 ? params.pageRangeSize : PAGE_RANGE_SIZE;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured.');
  }
  // 인투벳: 진료 본문을 이미지 박스로 넣어, 텍스트헤더가 있는 페이지의 박스를 PDF 직송(단일패스/PDF-슬라이스)으로는
  // 못 읽는다(디지털 텍스트 페이지로 오인해 이미지 스킵) → 페이지를 통째 렌더한 이미지로 전사한다.
  const forceRenderedPageImages = params.chartKind === 'intovet';
  // 클라이언트를 감싸 모든 generateContent sub-call(단일패스·이미지/PDF 슬라이스)의 usage 를 자동 적재.
  const client = withGenAiUsage(new GoogleGenAI({ apiKey }), { feature: 'extract', ...params.usageContext });
  const model = process.env.GEMINI_REPORT_MODEL ?? 'gemini-2.5-flash';

  try {
    // 인투벳은 단일패스(PDF 직송)가 이미지 박스를 스킵하므로 곧장 페이지-이미지 렌더 경로(아래 catch)로 보낸다.
    if (forceRenderedPageImages) {
      throw new Error('intovet — skip single-pass, render page images for full transcription');
    }
    // 큰 PDF는 단일패스 출력이 토큰 한도에 걸려 JSON이 잘리는 게 거의 확정 →
    // 254초쯤 낭비하지 말고 곧장 페이지-범위 추출(아래 catch)로 보낸다.
    const localPageCount = await getPdfPageCount(params.pdfBuffer).catch(() => 0);
    if (localPageCount > 14) {
      throw new Error(`large PDF (${localPageCount}p) — skip single-pass, go straight to page-range`);
    }
    const response = await client.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: 'Read this veterinary PDF in visual reading order and return plain ordered lines only. Do not bucket/classify. Return strict JSON. For any TABLE (e.g., a treatment/Plan table or a lab result table), output each table ROW as ONE single line containing all cells of that row left-to-right separated by single spaces; never split a single row across multiple lines, and never read a table column-by-column.' + SCRIPT_INSTRUCTION,
            },
            {
              inlineData: {
                mimeType: 'application/pdf',
                data: params.pdfBuffer.toString('base64'),
              },
            },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        maxOutputTokens: 65536,
        thinkingConfig: { thinkingBudget: 0 },
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            lines: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  page: { type: Type.NUMBER },
                  text: { type: Type.STRING },
                },
                required: ['page', 'text'],
              },
            },
          },
          required: ['lines'],
        },
      },
    });
    const output = response.text;
    if (!output) {
      throw new Error('Gemini single-pass response was empty; falling back to page-range extraction');
    }
    const parsed = parseJsonWithContext<{ lines?: OrderedLine[] }>(
      output,
      'Gemini ordered-lines JSON parse failed (single-pass)',
    );
    const singleLines = (parsed.lines ?? []).filter((line) => line.text?.trim().length > 0);

    let maxPage = 0;
    for (const l of singleLines) {
      const p = Number(l.page);
      if (Number.isFinite(p)) maxPage = Math.max(maxPage, Math.floor(p));
    }

    const pageCount = await resolvePdfPageCountForOrderedLines(params.pdfBuffer, client, model);

    const avgLinesPerPage = singleLines.length / Math.max(1, maxPage || 1);
    const looksTruncated =
      maxPage > 0 && maxPage < Math.max(2, pageCount - 2)
        ? true
        : pageCount >= 10 && avgLinesPerPage < 3;

    if (!looksTruncated) {
      return singleLines;
    }
    throw new Error(
      `single-pass output looks truncated (pages=${pageCount}, maxPage=${maxPage}, lines=${singleLines.length}, avgLinesPerPage=${avgLinesPerPage.toFixed(2)})`,
    );
  } catch (singlePassError) {
    const singleMsg = singlePassError instanceof Error ? singlePassError.message : String(singlePassError);
    console.log(`[Gemini ordered-lines] single-pass failed, starting page-range fallback. reason="${singleMsg}"`);
    const pageCount = await resolvePdfPageCountForOrderedLines(params.pdfBuffer, client, model);
    console.log(`[Gemini ordered-lines] fallback pageCount=${pageCount}`);

    // image-slice 는 "진짜 스캔 이미지 PDF"에만 맞다. 벡터 PDF(텍스트가 벡터 패스로 그려지고 사진/그래픽이 박힌 경우)는
    // 박힌 이미지를 "페이지"로 오인해 Gemini 에 보내면 본문(벡터 텍스트)을 못 읽는다 → 기본은 PDF-slice(실제 페이지 전송, Gemini 가 풀 렌더).
    // 진짜 이미지 PDF 라서 image-slice 가 필요하면 EXTRACT_USE_IMAGE_SLICE=1 로 켠다.
    // 인투벳(forceRenderedPageImages): 페이지를 통째 렌더한 JPEG 를 image-slice 로 태운다 →
    // 헤더 텍스트+이미지 박스가 한 장에 담겨 [S]/[O]/[A]/[PL] 전부 전사(텍스트레이어 스킵 문제 해소).
    const allJpegs = forceRenderedPageImages
      ? await renderPdfPagesToJpegs(params.pdfBuffer, 1, pageCount).catch((e) => {
          console.error('[Gemini ordered-lines] page-image render 실패 (PDF-slice 로 폴백):', e instanceof Error ? e.message : String(e));
          return null;
        })
      : process.env.EXTRACT_USE_IMAGE_SLICE === '1'
        ? await extractPageJpegsFromImagePdf(params.pdfBuffer, 1, pageCount).catch(() => null)
        : null;
    // 렌더한 페이지 이미지 모드에서만 "보이는 글자만 전사(사진 해석 금지)" 프롬프트를 쓴다.
    const transcribeVisibleTextOnly = forceRenderedPageImages && allJpegs !== null;
    if (allJpegs) {
      console.log(
        `[Gemini ordered-lines] image-slice mode: ${allJpegs.length} JPEGs (${forceRenderedPageImages ? 'rendered pages' : 'embedded'})`,
      );
    } else {
      console.log(`[Gemini ordered-lines] pdf-slice mode (실제 PDF 페이지를 Gemini 에 전송)`);
    }

    // 페이지-범위들을 동시성 제한 병렬로 처리(순차 대비 대폭 단축). 최종 순서는 mergeFallbackTaggedLines가 정렬로 보장.
    const ranges: Array<{ start: number; end: number }> = [];
    // overlap: 진료/표가 청크 경계에 걸쳐도 적어도 한 청크엔 온전히 들어오게 한다(겹친 줄은 dedup으로 정리).
    const overlap = Math.min(PAGE_RANGE_OVERLAP, pageRangeSize - 1);
    const step = Math.max(1, pageRangeSize - overlap);
    for (let start = 1; start <= pageCount; start += step) {
      const end = Math.min(pageCount, start + pageRangeSize - 1);
      ranges.push({ start, end });
      if (end >= pageCount) break;
    }
    // 진단: pageRangeSize 가 1이면 page-by-page(ranges=pageCount). 크면 한 호출에 여러 장→잘림.
    console.log(
      `[Gemini ordered-lines] page-range: pageRangeSize=${pageRangeSize} overlap=${overlap} ranges=${ranges.length} [${ranges.slice(0, 4).map((r) => `${r.start}-${r.end}`).join(",")}${ranges.length > 4 ? ",…" : ""}]`,
    );

    const processRange = async ({ start, end }: { start: number; end: number }): Promise<TaggedOrderedLine[]> => {
      const out: TaggedOrderedLine[] = [];
      const pagesInSlice = end - start + 1;

      if (allJpegs) {
        const images = allJpegs.slice(start - 1, end);
        const batchLines = await extractOrderedLinesFromGeminiImageSlice({ client, model, images, transcribeVisibleTextOnly });

        if (batchLines.length === 0 && images.length > 1) {
          console.log(`[Gemini ordered-lines] batch p${start}-${end} empty, retrying page-by-page`);
          for (let p = start; p <= end; p++) {
            const img = allJpegs[p - 1];
            if (!img || img.length < 10_000) continue;
            const pageLines = await extractOrderedLinesFromGeminiImageSlice({ client, model, images: [img], transcribeVisibleTextOnly });
            pageLines.forEach((line, seq) => {
              const t = line.text?.trim();
              if (!t) return;
              out.push({ page: p, text: t, rangeStart: start, seqInRange: seq });
            });
          }
        } else {
          batchLines.forEach((line, seqInRange) => {
            const t = line.text?.trim();
            if (!t) return;
            const local = Math.floor(Number(line.page));
            if (!Number.isFinite(local)) return;
            const globalPage =
              local >= 1 && local <= pagesInSlice
                ? start - 1 + local
                : Math.min(end, Math.max(start, local));
            out.push({ page: globalPage, text: t, rangeStart: start, seqInRange });
          });
        }
      } else {
        const slice = await slicePdfPages(params.pdfBuffer, start, end);
        const lines = await extractOrderedLinesFromGeminiPdfSlice({ client, model, pdfBuffer: slice });
        lines.forEach((line, seqInRange) => {
          const t = line.text?.trim();
          if (!t) return;
          const local = Math.floor(Number(line.page));
          if (!Number.isFinite(local)) return;
          const globalPage =
            local >= 1 && local <= pagesInSlice
              ? start - 1 + local
              : Math.min(end, Math.max(start, local));
          out.push({ page: globalPage, text: t, rangeStart: start, seqInRange });
        });
      }
      return out;
    };

    const FALLBACK_CONCURRENCY = 4;
    const merged: TaggedOrderedLine[] = [];
    for (let i = 0; i < ranges.length; i += FALLBACK_CONCURRENCY) {
      const batch = ranges.slice(i, i + FALLBACK_CONCURRENCY);
      const results = await Promise.all(batch.map(processRange));
      for (const r of results) merged.push(...r);
    }
    const deduped = mergeFallbackTaggedLines(merged);
    if (deduped.length > 0) {
      return deduped;
    }
    throw new Error(`Gemini ordered-lines fallback produced empty result; single-pass error: ${singleMsg}`);
  }
}
