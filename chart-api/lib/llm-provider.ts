export type LlmProvider = 'openai' | 'gemini';

export function getLlmProvider(): LlmProvider {
  const provider = (process.env.LLM_PROVIDER ?? 'openai').trim().toLowerCase();
  return provider === 'gemini' ? 'gemini' : 'openai';
}

export function hasLlmApiKey(provider = getLlmProvider()) {
  if (provider === 'gemini') {
    return Boolean(process.env.GEMINI_API_KEY);
  }
  return Boolean(process.env.OPENAI_API_KEY);
}
