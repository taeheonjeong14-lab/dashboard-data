/**
 * Thin Gemini REST caller — vet-report 포팅 전까지 최소 의존 LLM.
 * GEMINI_API_KEY 또는 NEXT_PUBLIC_GEMINI_API_KEY 사용 (ddx-api와 동일 계열).
 */
import { recordTokenUsage, geminiUsageFromMetadata, type UsageContext } from '@/lib/billing/usage-log';

/**
 * 일시 오류(구글 과부하·점검·레이트리밋·게이트웨이)로 보는 HTTP 상태.
 * 503 UNAVAILABLE 이 대표적이고, 429 는 레이트리밋이라 잠깐 쉬면 풀린다.
 */
const RETRYABLE_HTTP_STATUS = new Set([408, 429, 500, 502, 503, 504]);

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 800;

/**
 * 재시도가 과금을 늘리지 않는 이유 — **응답을 받아 본문까지 성공한 호출만** recordTokenUsage 로
 * 적재하고, 차감(billing.token_charge_operation)은 그 적재분의 합산 원가로 계산한다.
 * 여기서 재시도하는 건 HTTP 단계에서 실패해 적재가 아예 없는 호출뿐이라, 구글도 우리도 비용이 0이다.
 * ★그래서 "응답은 200인데 내용이 마음에 안 든다"(빈 텍스트·파싱 실패)는 절대 여기서 재시도하지 않는다.
 *   그건 이미 구글이 토큰을 태운 호출이라, 다시 부르면 진짜로 비용이 두 배가 된다.
 */
async function geminiFetchWithRetry(url: string, body: unknown): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      // 네트워크 단절 등 — 요청이 닿지 않았으므로 과금도 없다.
      lastError = e;
      if (attempt === MAX_ATTEMPTS) throw e;
      await sleep(backoffMs(attempt));
      continue;
    }

    if (res.ok || !RETRYABLE_HTTP_STATUS.has(res.status) || attempt === MAX_ATTEMPTS) {
      return res;
    }

    const retryAfter = parseRetryAfterMs(res.headers.get('retry-after'));
    console.warn(
      `[gemini] HTTP ${res.status} — ${attempt}/${MAX_ATTEMPTS} 재시도 (${retryAfter ?? backoffMs(attempt)}ms 후)`,
    );
    await sleep(retryAfter ?? backoffMs(attempt));
  }

  // 위 루프는 항상 return 하거나 throw 하지만, 타입상 도달 가능해 방어적으로 둔다.
  throw lastError ?? new Error('Gemini request failed');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 지수 backoff + 지터(동시에 7개가 몰려 같은 순간 재시도하는 것을 흩는다). */
function backoffMs(attempt: number): number {
  return BASE_BACKOFF_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * 300);
}

/** `Retry-After`(초). 터무니없이 길면 무시하고 기본 backoff 를 쓴다. */
function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header.trim());
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 10) return null;
  return Math.ceil(seconds * 1000);
}

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

  const res = await geminiFetchWithRetry(url, requestBody);

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

  const res = await geminiFetchWithRetry(url, {
    contents: [{ parts: apiParts }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 8192 },
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
