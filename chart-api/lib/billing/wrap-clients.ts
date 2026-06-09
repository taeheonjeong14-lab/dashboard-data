import {
  recordTokenUsage,
  geminiUsageFromMetadata,
  openaiResponsesUsage,
  type UsageContext,
} from '@/lib/billing/usage-log';

/**
 * LLM 클라이언트의 호출 메서드를 래핑해, 호출마다 usage 를 billing.llm_usage 에 적재한다.
 * 추출처럼 한 작업이 sub-call(페이지 슬라이스 등) 여러 번이어도 호출 지점을 일일이 고치지 않고
 * 클라이언트 한 번 감싸면 전부 잡힌다.
 */

type GenAiGenerate = (req: { model?: string }) => Promise<{ usageMetadata?: unknown }>;

/** @google/genai 클라이언트의 models.generateContent 래핑(Gemini). */
export function withGenAiUsage<T>(client: T, ctx: UsageContext): T {
  const models = (client as { models?: { generateContent?: GenAiGenerate } }).models;
  if (!models || typeof models.generateContent !== 'function') return client;
  const orig = models.generateContent.bind(models) as GenAiGenerate;
  models.generateContent = async (req) => {
    const resp = await orig(req);
    try {
      await recordTokenUsage({
        provider: 'gemini',
        model: req?.model ?? '',
        ...geminiUsageFromMetadata((resp as { usageMetadata?: unknown })?.usageMetadata),
        ...ctx,
      });
    } catch {
      /* 로깅 실패는 무시 */
    }
    return resp;
  };
  return client;
}

type OpenAiResponsesCreate = (req: { model?: string }) => Promise<{ usage?: unknown }>;

/** OpenAI 클라이언트의 responses.create 래핑(Responses API). */
export function withOpenAiResponsesUsage<T>(client: T, ctx: UsageContext): T {
  const responses = (client as { responses?: { create?: OpenAiResponsesCreate } }).responses;
  if (!responses || typeof responses.create !== 'function') return client;
  const orig = responses.create.bind(responses) as OpenAiResponsesCreate;
  responses.create = async (req) => {
    const resp = await orig(req);
    try {
      await recordTokenUsage({
        provider: 'openai',
        model: req?.model ?? '',
        ...openaiResponsesUsage((resp as { usage?: unknown })?.usage),
        ...ctx,
      });
    } catch {
      /* 로깅 실패는 무시 */
    }
    return resp;
  };
  return client;
}
