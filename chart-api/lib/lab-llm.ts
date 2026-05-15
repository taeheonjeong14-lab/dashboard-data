import OpenAI from 'openai';
import { GoogleGenAI, Type } from '@google/genai';
import type { LabItem } from '@/lib/lab-parser';
import type { OcrRow } from '@/lib/google-vision';
import { getLlmProvider } from '@/lib/llm-provider';

type LlmLabItem = {
  itemName: string;
  valueText: string;
  unit: string | null;
  referenceRange: string | null;
  flag: 'low' | 'high' | 'normal' | 'unknown';
  confidence: number | null;
};

type LlmLabExtraction = {
  labDate: string | null;
  labItems: LabItem[];
};

function normalizeNumericString(token: string) {
  return token.replace(',', '.');
}

function toLabItems(parsed: LlmLabItem[]): LabItem[] {
  return parsed.map((item, index) => {
    const parsedValue = Number.parseFloat(normalizeNumericString(item.valueText));
    return {
      page: 0,
      rowY: index,
      itemName: item.itemName.trim(),
      value: Number.isFinite(parsedValue) ? parsedValue : null,
      valueText: item.valueText.trim(),
      unit: item.unit?.trim() || null,
      referenceRange: item.referenceRange?.trim() || null,
      flag: item.flag,
      rawRow: '',
    };
  });
}

export async function extractLabItemsWithLlm({
  text,
  rows,
}: {
  text: string;
  rows: OcrRow[];
}): Promise<LlmLabExtraction> {
  const provider = getLlmProvider();
  if (provider === 'gemini') {
    return extractLabItemsWithGemini({ text, rows });
  }
  return extractLabItemsWithOpenAi({ text, rows });
}

async function extractLabItemsWithOpenAi({
  text,
  rows,
}: {
  text: string;
  rows: OcrRow[];
}): Promise<LlmLabExtraction> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured.');
  }

  const client = new OpenAI({ apiKey });
  const rowPreview = rows.slice(0, 260).map((row) => row.text).join('\n');

  const response = await client.responses.create({
    model: process.env.OPENAI_LAB_MODEL ?? 'gpt-4.1-mini',
    input: [
      {
        role: 'system',
        content:
          'You extract only veterinary blood test rows from OCR text. Return strict JSON.',
      },
      {
        role: 'user',
        content: `Extract blood-test items from this OCR content.

Rules:
- Keep only blood test analytes (e.g., ALT, AST, ALP, BUN, CREA, ALB/GLOB, BUN/CREA, GLU, WBC, RBC, HGB, HCT, PLT, CRP, etc.).
- Exclude headers, dates, addresses, phone numbers, diagnoses, and non-lab narrative text.
- For each item return: itemName, valueText, unit, referenceRange, flag, confidence.
- flag must be one of: low | high | normal | unknown.
- If unknown, use null for unit/referenceRange where appropriate.
- Also extract labDate (blood test date) in YYYY-MM-DD when possible. If uncertain, use null.

OCR_TEXT:
${text.slice(0, 12000)}

OCR_ROWS_PREVIEW:
${rowPreview}`,
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'lab_items',
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            labDate: { type: ['string', 'null'] },
            labItems: {
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
                  confidence: { type: ['number', 'null'] },
                },
                required: [
                  'itemName',
                  'valueText',
                  'unit',
                  'referenceRange',
                  'flag',
                  'confidence',
                ],
              },
            },
          },
          required: ['labDate', 'labItems'],
        },
      },
    },
  });

  const output = response.output_text;
  if (!output) {
    return { labDate: null, labItems: [] };
  }

  const parsed = JSON.parse(output) as {
    labDate?: string | null;
    labItems?: LlmLabItem[];
  };
  const labItems = (parsed.labItems ?? []).filter(
    (item) => item.itemName.length > 1 && item.valueText.length > 0,
  );
  return {
    labDate: parsed.labDate ?? null,
    labItems: toLabItems(labItems),
  };
}

async function extractLabItemsWithGemini({
  text,
  rows,
}: {
  text: string;
  rows: OcrRow[];
}): Promise<LlmLabExtraction> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured.');
  }

  const client = new GoogleGenAI({ apiKey });
  const model = process.env.GEMINI_LAB_MODEL ?? 'gemini-2.5-flash';
  const rowPreview = rows.slice(0, 260).map((row) => row.text).join('\n');

  const prompt = `Extract blood-test items from this OCR content.

Rules:
- Keep only blood test analytes (e.g., ALT, AST, ALP, BUN, CREA, ALB/GLOB, BUN/CREA, GLU, WBC, RBC, HGB, HCT, PLT, CRP, etc.).
- Exclude headers, dates, addresses, phone numbers, diagnoses, and non-lab narrative text.
- For each item return: itemName, valueText, unit, referenceRange, flag, confidence.
- flag must be one of: low | high | normal | unknown.
- If unknown, use null for unit/referenceRange where appropriate.
- Also extract labDate (blood test date) in YYYY-MM-DD when possible. If uncertain, use null.

OCR_TEXT:
${text.slice(0, 12000)}

OCR_ROWS_PREVIEW:
${rowPreview}`;

  const response = await client.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          labDate: { type: Type.STRING, nullable: true },
          labItems: {
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
                confidence: { type: Type.NUMBER, nullable: true },
              },
              required: [
                'itemName',
                'valueText',
                'unit',
                'referenceRange',
                'flag',
                'confidence',
              ],
            },
          },
        },
        required: ['labDate', 'labItems'],
      },
    },
  });

  const output = response.text;
  if (!output) {
    return { labDate: null, labItems: [] };
  }

  const parsed = JSON.parse(output) as {
    labDate?: string | null;
    labItems?: LlmLabItem[];
  };
  const labItems = (parsed.labItems ?? []).filter(
    (item) => item.itemName.length > 1 && item.valueText.length > 0,
  );

  return {
    labDate: parsed.labDate ?? null,
    labItems: toLabItems(labItems),
  };
}
