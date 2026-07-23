/**
 * 블로그 글 검수 — 멀티 LLM 앙상블(Vercel AI Gateway, OpenAI 호환 엔드포인트).
 * 리뷰어 3개 병렬 + 집계 1개, 모두 같은 operationId 아래 usage 적재 → 합산 1회 차감.
 * 기준·프롬프트·판정은 @dashboard/blog-review-rubric 단일 소스에서. 설계: docs/blog-review-spec.md
 */
import OpenAI from 'openai';
import {
  buildAggregatorSystemPrompt,
  buildAggregatorUserContent,
  buildReviewerSystemPrompt,
  buildReviewerUserContent,
  type Agreement,
  type AggregatorOutput,
  type Finding,
  type ReviewerBreakdown,
  type ReviewerFinding,
  type ReviewerOutput,
  type ReviewInput,
  type Severity,
} from '@dashboard/blog-review-rubric';
import { openaiChatUsage, recordTokenUsage, type UsageContext } from '@/lib/billing/usage-log';
import { tryParseJsonObject } from '@/lib/chart-app/gemini';

const GATEWAY_BASE = process.env.AI_GATEWAY_BASE_URL?.trim() || 'https://ai-gateway.vercel.sh/v1';

/**
 * 리뷰어 모델(슬러그는 점 표기 provider/model). 비용 절감 조합(싸되 추론 가능한 티어).
 * 게이트웨이 카탈로그 변동 시 env(BLOG_REVIEW_MODELS)로 오버라이드. 확정은 /api/debug/blog-review-models.
 */
const REVIEWER_MODELS = (process.env.BLOG_REVIEW_MODELS?.trim() ||
  'anthropic/claude-haiku-4.5,xai/grok-4.1-fast-reasoning,google/gemini-2.5-flash')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** 집계 모델. haiku 는 지시(개조식·길이) 준수가 나아 gemini-flash 대비 문체가 짧게 나온다. */
const AGGREGATOR_MODEL = process.env.BLOG_REVIEW_AGGREGATOR_MODEL?.trim() || 'anthropic/claude-haiku-4.5';

/** 응답 토큰 상한. 너무 낮으면 JSON 이 잘려 파싱 실패("Unterminated string")한다. */
const MAX_TOKENS = Number(process.env.BLOG_REVIEW_MAX_TOKENS) || 8000;

/** 리뷰어/집계 호출 최대 시도 횟수(첫 시도 포함). 게이트웨이 일시 429/5xx 버스트 흡수용. */
const MAX_ATTEMPTS = Number(process.env.BLOG_REVIEW_MAX_ATTEMPTS) || 4;

function gatewayClient(): OpenAI {
  const apiKey = process.env.AI_GATEWAY_API_KEY?.trim();
  if (!apiKey) throw new Error('AI_GATEWAY_API_KEY is not configured');
  // SDK 자체 재시도는 끄고(maxRetries:0) 아래 chatWithRetry 로 직접 제어한다 —
  // 겹치면 시도 횟수가 곱해져(SDK 3 × 우리 4) 시간 예산을 태운다.
  return new OpenAI({ apiKey, baseURL: GATEWAY_BASE, maxRetries: 0 });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 일시 오류만 재시도한다. 네트워크 오류(status 없음)·429·408·409·5xx 는 일시, 그 외 4xx(400/401/403/404)는 영구(설정·인증 문제라 재시도 무의미). */
function isTransientError(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  if (status == null) return true; // 연결 끊김·타임아웃 등
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

/** 429 응답의 Retry-After(초) 헤더를 ms 로. 없거나 파싱 불가면 null → 지수 백오프 사용. 상한 20s. */
function retryAfterMs(err: unknown): number | null {
  const headers = (err as { headers?: Record<string, string> } | null)?.headers;
  const raw = headers?.['retry-after'];
  if (!raw) return null;
  const secs = Number(raw);
  return Number.isFinite(secs) && secs >= 0 ? Math.min(secs * 1000, 20_000) : null;
}

/** 지수 백오프 + 지터. attempt 1→~0.8s, 2→~1.6s, 3→~3.2s. */
function backoffMs(attempt: number): number {
  return 800 * 2 ** (attempt - 1) + Math.floor(Math.random() * 400);
}

/**
 * chatOnce 를 감싼 재시도 래퍼. 일시 오류면 Retry-After(있으면) 또는 지수 백오프 후 재시도,
 * 영구 오류면 즉시 던진다. 재시도 이력은 로그로 남겨 다음 장애 때 소진이 보이게 한다.
 */
async function chatWithRetry(
  client: OpenAI,
  model: string,
  system: string,
  user: string,
  ctx: UsageContext,
  temperature: number,
): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await chatOnce(client, model, system, user, ctx, temperature);
    } catch (e) {
      lastErr = e;
      if (attempt >= MAX_ATTEMPTS || !isTransientError(e)) break;
      const wait = retryAfterMs(e) ?? backoffMs(attempt);
      const status = (e as { status?: number } | null)?.status ?? 'net';
      console.warn(`[blog-review] ${model} 호출 실패(${status}) — ${attempt}/${MAX_ATTEMPTS}, ${wait}ms 후 재시도`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

/** 슬러그 앞부분(provider)만 usage 로깅용으로 뽑는다. cost 계산은 model 전체 문자열로 단가표 매칭. */
function providerOf(model: string): string {
  const i = model.indexOf('/');
  return i > 0 ? model.slice(0, i) : model;
}

/** 게이트웨이 chat.completions 1회 + usage 적재. JSON 은 프롬프트로 강제(파싱은 tryParseJsonObject). */
async function chatOnce(
  client: OpenAI,
  model: string,
  system: string,
  user: string,
  ctx: UsageContext,
  temperature: number,
): Promise<string> {
  const resp = await client.chat.completions.create({
    model,
    temperature,
    max_tokens: MAX_TOKENS,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  try {
    await recordTokenUsage({
      provider: providerOf(model),
      model,
      ...openaiChatUsage((resp as { usage?: unknown }).usage),
      ...ctx,
    });
  } catch {
    /* 로깅 실패 무시 */
  }
  return resp.choices?.[0]?.message?.content ?? '';
}

const SEVERITIES: Severity[] = ['high', 'medium', 'low'];
function clampSeverity(v: unknown): Severity {
  return SEVERITIES.includes(v as Severity) ? (v as Severity) : 'low';
}

function asFindingBase(x: unknown): ReviewerFinding | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const issue = String(o.issue ?? '').trim();
  if (!issue) return null;
  return {
    rubricId: String(o.rubricId ?? '').trim() || 'M1',
    severity: clampSeverity(o.severity),
    quote: o.quote != null ? String(o.quote) : undefined,
    issue,
    suggestion: String(o.suggestion ?? '').trim(),
    evidence: o.evidence != null ? String(o.evidence) : undefined,
  };
}

function normalizeReviewerOutput(parsed: unknown): ReviewerOutput {
  const o = (parsed ?? {}) as Record<string, unknown>;
  const arr = (v: unknown): ReviewerFinding[] =>
    (Array.isArray(v) ? v : []).map(asFindingBase).filter((f): f is ReviewerFinding => f != null);
  return { medical: arr(o.medical), seo: arr(o.seo) };
}

const AGREEMENTS = ['3/3', '2/3', '1/3'] as const;
const agreementOf = (count: number): Agreement => (count >= 3 ? '3/3' : count >= 2 ? '2/3' : '1/3');

/**
 * 집계가 준 sources(["A","B"] = REVIEW_A·REVIEW_B) 를 실제 모델 슬러그로 되돌린다.
 * 라벨 순서는 buildAggregatorUserContent 에 넘긴 리뷰어 순서(modelsUsed)와 같다.
 */
function mapSources(x: unknown, modelsUsed: string[]): string[] {
  const raw = (x as Record<string, unknown> | null)?.sources;
  if (!Array.isArray(raw)) return [];
  const models = raw
    .map((s) => String(s).trim().toUpperCase().replace(/^REVIEW_/, ''))
    .map((label) => modelsUsed[label.charCodeAt(0) - 65])
    .filter((m): m is string => Boolean(m));
  return [...new Set(models)];
}

function asAggFinding(x: unknown, modelsUsed: string[]): Finding | null {
  const base = asFindingBase(x);
  if (!base) return null;
  const models = mapSources(x, modelsUsed);
  const ag = (x as Record<string, unknown>).agreement;
  // sources 가 있으면 그쪽이 우선(합의도 = 실제 지적한 모델 수). 없으면 집계가 준 agreement 문자열.
  const agreement = models.length
    ? agreementOf(models.length)
    : (AGREEMENTS as readonly string[]).includes(String(ag))
      ? (String(ag) as Agreement)
      : '1/3';
  return { ...base, agreement, ...(models.length ? { models } : {}) };
}

function normalizeAggregatorOutput(parsed: unknown, modelsUsed: string[]): AggregatorOutput {
  const o = (parsed ?? {}) as Record<string, unknown>;
  const arr = (v: unknown): Finding[] =>
    (Array.isArray(v) ? v : [])
      .map((x) => asAggFinding(x, modelsUsed))
      .filter((f): f is Finding => f != null);
  return { medical: arr(o.medical), seo: arr(o.seo), summary: String(o.summary ?? '').trim() };
}

/** 단일 리뷰어만 성공했을 때: 집계 없이 모든 finding 을 1/3(저신뢰)로 감싼다. */
function wrapSingle(out: ReviewerOutput, model: string): AggregatorOutput {
  const wrap = (f: ReviewerFinding): Finding => ({ ...f, agreement: '1/3', models: [model] });
  return { medical: out.medical.map(wrap), seo: out.seo.map(wrap), summary: '' };
}

/**
 * 집계 LLM 실패 시 폴백 — 리뷰어 findings 를 규칙 기반으로 병합.
 * rubricId + 인용/이슈 앞부분으로 묶어 중복 제거, 같은 지적을 낸 리뷰어들로 agreement·models 산정.
 */
function programmaticMerge(outputs: Array<{ model: string; norm: ReviewerOutput }>): AggregatorOutput {
  const mergeAxis = (pick: (o: ReviewerOutput) => ReviewerFinding[]): Finding[] => {
    const groups = new Map<string, { f: ReviewerFinding; models: string[] }>();
    for (const { model, norm } of outputs) {
      // 한 리뷰어가 같은 키를 중복으로 내도 1회만 센다.
      const seen = new Set<string>();
      for (const f of pick(norm)) {
        const key = `${f.rubricId}|${(f.quote || f.issue).replace(/\s+/g, '').slice(0, 20)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const g = groups.get(key);
        if (g) g.models.push(model);
        else groups.set(key, { f, models: [model] });
      }
    }
    return [...groups.values()]
      .map(({ f, models }) => ({ ...f, agreement: agreementOf(models.length), models }))
      .sort((a, b) => b.agreement.localeCompare(a.agreement));
  };
  return {
    medical: mergeAxis((o) => o.medical),
    seo: mergeAxis((o) => o.seo),
    summary: '(집계 모델 응답을 파싱하지 못해 리뷰어 결과를 규칙 기반으로 병합했습니다.)',
  };
}

/** 리뷰어 원문 → 정규화. 파싱 실패면 null(그 리뷰어는 건너뜀). */
function parseReviewer(raw: string, model: string): ReviewerOutput | null {
  try {
    return normalizeReviewerOutput(tryParseJsonObject(raw));
  } catch (e) {
    console.warn('[blog-review] reviewer 파싱 실패:', model, e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * 앙상블 실행. 리뷰어 3개 병렬 → 성공분으로 집계.
 * 호출 실패·파싱 실패한 리뷰어는 건너뛰고(1개라도 남으면 진행), 집계 LLM 이 깨지면 규칙 병합으로 폴백.
 */
export async function runBlogReviewEnsemble(
  input: ReviewInput,
  ctx: (feature: string) => UsageContext,
): Promise<{ aggregate: AggregatorOutput; modelsUsed: string[]; reviewers: ReviewerBreakdown[] }> {
  const client = gatewayClient();
  const sysReviewer = buildReviewerSystemPrompt();
  const userReviewer = buildReviewerUserContent(input);
  const reviewCtx = ctx('blog_review');

  const settled = await Promise.allSettled(
    REVIEWER_MODELS.map((m) => chatWithRetry(client, m, sysReviewer, userReviewer, reviewCtx, 0.15)),
  );

  const outputs: Array<{ model: string; norm: ReviewerOutput }> = [];
  settled.forEach((r, i) => {
    const model = REVIEWER_MODELS[i];
    if (r.status !== 'fulfilled') {
      console.warn('[blog-review] reviewer 호출 실패:', model, r.reason instanceof Error ? r.reason.message : r.reason);
      return;
    }
    const norm = parseReviewer(r.value, model);
    if (norm) outputs.push({ model, norm });
  });

  if (outputs.length === 0) throw new Error('모든 리뷰어 호출/파싱이 실패했습니다');

  const modelsUsed = outputs.map((o) => o.model);
  // 모델별 원본 findings(펼쳐 보는 상세용).
  const reviewers: ReviewerBreakdown[] = outputs.map((o) => ({ model: o.model, medical: o.norm.medical, seo: o.norm.seo }));

  // 리뷰어가 1개뿐이면 집계 불필요(전부 저신뢰).
  if (outputs.length === 1) {
    return { aggregate: wrapSingle(outputs[0].norm, outputs[0].model), modelsUsed, reviewers };
  }

  // 집계 LLM — 실패(호출·파싱)하면 규칙 기반 병합으로 폴백해 500 을 피한다.
  try {
    const aggText = await chatWithRetry(
      client,
      AGGREGATOR_MODEL,
      buildAggregatorSystemPrompt(),
      buildAggregatorUserContent(outputs.map((o) => JSON.stringify(o.norm))),
      reviewCtx,
      0.1,
    );
    const aggregate = normalizeAggregatorOutput(tryParseJsonObject(aggText), modelsUsed);
    // 집계가 비었는데 리뷰어엔 findings 가 있으면(모델이 형식만 맞추고 내용 유실) 폴백.
    const aggEmpty = aggregate.medical.length + aggregate.seo.length === 0;
    const hadFindings = outputs.some((o) => o.norm.medical.length + o.norm.seo.length > 0);
    if (aggEmpty && hadFindings) return { aggregate: programmaticMerge(outputs), modelsUsed, reviewers };
    return { aggregate, modelsUsed, reviewers };
  } catch (e) {
    console.warn('[blog-review] 집계 실패 → 규칙 병합 폴백:', e instanceof Error ? e.message : e);
    return { aggregate: programmaticMerge(outputs), modelsUsed, reviewers };
  }
}
