/**
 * Thin Gemini REST caller — vet-report 포팅 전까지 최소 의존 LLM.
 * GEMINI_API_KEY 또는 NEXT_PUBLIC_GEMINI_API_KEY 사용 (ddx-api와 동일 계열).
 */
import { recordTokenUsage, geminiUsageFromMetadata, type UsageContext } from '@/lib/billing/usage-log';

export type GeminiTextOptions = {
  /** 기본 8192. 긴 버킷팅 JSON 등은 늘림 */
  maxOutputTokens?: number;
  /** 기본 0.3. 사실 기반(저창의) 출력이 필요하면 낮춤(예: 건강검진 0.18) */
  temperature?: number;
  /**
   * Gemini 2.5 계열 thinking 토큰 예산.
   * 명시하면 그 값을 그대로 쓰고(0=끔, 양수=고정, -1=동적), 생략하면 기존 기본값
   * (2.5-flash 는 0으로 끔)을 따른다. 2.5-flash 허용 범위 0~24576.
   */
  thinkingBudget?: number;
  /** systemInstruction(역할/규칙) 을 user content 와 분리해 전달 */
  systemInstruction?: string;
  /** 과금 로깅용 컨텍스트(병원/사용자/기능/run). 제공 시 billing.llm_usage 에 적재. */
  usageContext?: UsageContext;
};

export async function geminiGenerateText(prompt: string, opts?: GeminiTextOptions): Promise<string> {
  const key =
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.NEXT_PUBLIC_GEMINI_API_KEY?.trim();
  if (!key) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const model = process.env.GEMINI_MODEL?.trim() || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;

  const maxOut = opts?.maxOutputTokens ?? 8192;
  const temperature = opts?.temperature ?? 0.3;

  // thinking 토큰은 maxOutputTokens 를 함께 소모해 본문이 잘릴 수 있다(finishReason=MAX_TOKENS).
  // 옵션으로 thinkingBudget 을 명시하면 그 값을 그대로 쓰고(단계별 제어용),
  // 생략하면 기존 기본값(2.5-flash 계열은 0으로 끔)을 따른다.
  const generationConfig: Record<string, unknown> = { temperature, maxOutputTokens: maxOut };
  if (opts?.thinkingBudget !== undefined) {
    generationConfig.thinkingConfig = { thinkingBudget: opts.thinkingBudget };
  } else if (/2\.5-flash/i.test(model)) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }

  const requestBody: Record<string, unknown> = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig,
  };
  if (opts?.systemInstruction?.trim()) {
    requestBody.systemInstruction = { parts: [{ text: opts.systemInstruction }] };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini HTTP ${res.status}: ${t.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
    usageMetadata?: unknown;
  };
  const cand = data.candidates?.[0];
  const text = cand?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text) {
    throw new Error(`Gemini returned empty text${cand?.finishReason ? ` (finishReason=${cand.finishReason})` : ''}`);
  }
  if (cand?.finishReason === 'MAX_TOKENS') {
    console.warn(`[gemini] output truncated: finishReason=MAX_TOKENS model=${model} maxOut=${maxOut}`);
  }
  await recordTokenUsage({
    provider: 'gemini',
    model,
    ...geminiUsageFromMetadata(data.usageMetadata),
    ...(opts?.usageContext ?? {}),
  });
  return text;
}

/** Multimodal parts for generateContent (REST uses snake_case inline_data). */
export type GeminiContentPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

export async function geminiGenerateFromParts(
  parts: GeminiContentPart[],
  usageContext?: UsageContext,
): Promise<string> {
  const key =
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.NEXT_PUBLIC_GEMINI_API_KEY?.trim();
  if (!key) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const model = process.env.GEMINI_MODEL?.trim() || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;

  const apiParts = parts.map((p) => {
    if ('inlineData' in p) {
      return {
        inline_data: {
          mime_type: p.inlineData.mimeType,
          data: p.inlineData.data,
        },
      };
    }
    return { text: p.text };
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: apiParts }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 8192 },
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini HTTP ${res.status}: ${t.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: unknown;
  };
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
  if (!text) throw new Error('Gemini returned empty text');
  await recordTokenUsage({
    provider: 'gemini',
    model,
    ...geminiUsageFromMetadata(data.usageMetadata),
    ...(usageContext ?? {}),
  });
  return text;
}

/**
 * 첫 번째 균형 잡힌 `{ ... }` 블록만 잘라 낸다 (앞뒤 설명·코드펜스 잔여물 제거).
 * 문자열 리터럴 안의 `{` `}` 는 무시한다.
 */
export function extractFirstBalancedJsonObject(raw: string): string | null {
  const start = raw.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (c === '\\') {
        escape = true;
        continue;
      }
      if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * LLM이 JSON 문자열 내부에 raw newline/tab을 넣어 깨뜨리는 경우를 보정한다.
 * (JSON string 안에서는 \n, \r, \t 로 escape 되어야 함)
 */
function escapeInvalidJsonStringChars(input: string): string {
  let out = '';
  let inString = false;
  let escape = false;

  for (let i = 0; i < input.length; i++) {
    const c = input[i];

    if (!inString) {
      if (c === '"') inString = true;
      out += c;
      continue;
    }

    // inside JSON string
    if (escape) {
      out += c;
      escape = false;
      continue;
    }

    if (c === '\\') {
      out += c;
      escape = true;
      continue;
    }

    if (c === '"') {
      out += c;
      inString = false;
      continue;
    }

    if (c === '\n') {
      out += '\\n';
      continue;
    }
    if (c === '\r') {
      out += '\\r';
      continue;
    }
    if (c === '\t') {
      out += '\\t';
      continue;
    }

    out += c;
  }

  return out;
}

/** Try parse JSON object from model output (strip markdown fences, fallback brace slice). */
export function tryParseJsonObject(raw: string): unknown {
  let s = raw.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  }

  const tryParse = (chunk: string): unknown => JSON.parse(chunk) as unknown;

  try {
    return tryParse(s);
  } catch (firstErr) {
    // 1) Try lightweight sanitation against invalid control chars in JSON strings.
    try {
      return tryParse(escapeInvalidJsonStringChars(s));
    } catch {
      /* continue */
    }

    // 2) Fallback: slice first balanced object and retry (+sanitized retry).
    const sliced = extractFirstBalancedJsonObject(s);
    if (sliced) {
      try {
        return tryParse(sliced);
      } catch {
        try {
          return tryParse(escapeInvalidJsonStringChars(sliced));
        } catch {
          /* keep firstErr */
        }
      }
    }
    throw firstErr;
  }
}
