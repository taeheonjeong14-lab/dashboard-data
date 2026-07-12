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

/** 집계 모델(중립 병합 — 검수보다 쉬워 저가 모델로 충분). */
const AGGREGATOR_MODEL = process.env.BLOG_REVIEW_AGGREGATOR_MODEL?.trim() || 'google/gemini-2.5-flash';

/** 응답 토큰 상한. 너무 낮으면 JSON 이 잘려 파싱 실패("Unterminated string")한다. */
const MAX_TOKENS = Number(process.env.BLOG_REVIEW_MAX_TOKENS) || 8000;

function gatewayClient(): OpenAI {
  const apiKey = process.env.AI_GATEWAY_API_KEY?.trim();
  if (!apiKey) throw new Error('AI_GATEWAY_API_KEY is not configured');
  return new OpenAI({ apiKey, baseURL: GATEWAY_BASE });
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
function asAggFinding(x: unknown): Finding | null {
  const base = asFindingBase(x);
  if (!base) return null;
  const ag = (x as Record<string, unknown>).agreement;
  const agreement = (AGREEMENTS as readonly string[]).includes(String(ag)) ? (String(ag) as Finding['agreement']) : '1/3';
  return { ...base, agreement };
}

function normalizeAggregatorOutput(parsed: unknown): AggregatorOutput {
  const o = (parsed ?? {}) as Record<string, unknown>;
  const arr = (v: unknown): Finding[] =>
    (Array.isArray(v) ? v : []).map(asAggFinding).filter((f): f is Finding => f != null);
  return { medical: arr(o.medical), seo: arr(o.seo), summary: String(o.summary ?? '').trim() };
}

/** 단일 리뷰어만 성공했을 때: 집계 없이 모든 finding 을 1/3(저신뢰)로 감싼다. */
function wrapSingle(out: ReviewerOutput): AggregatorOutput {
  const wrap = (f: ReviewerFinding): Finding => ({ ...f, agreement: '1/3' });
  return { medical: out.medical.map(wrap), seo: out.seo.map(wrap), summary: '' };
}

/**
 * 집계 LLM 실패 시 폴백 — 리뷰어 findings 를 규칙 기반으로 병합.
 * rubricId + 인용/이슈 앞부분으로 묶어 중복 제거, 몇 개 리뷰어가 같은 지적을 냈나로 agreement 산정.
 */
function programmaticMerge(outputs: ReviewerOutput[]): AggregatorOutput {
  const mergeAxis = (pick: (o: ReviewerOutput) => ReviewerFinding[]): Finding[] => {
    const groups = new Map<string, { f: ReviewerFinding; count: number }>();
    for (const o of outputs) {
      // 한 리뷰어가 같은 키를 중복으로 내도 1회만 센다.
      const seen = new Set<string>();
      for (const f of pick(o)) {
        const key = `${f.rubricId}|${(f.quote || f.issue).replace(/\s+/g, '').slice(0, 20)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const g = groups.get(key);
        if (g) g.count += 1;
        else groups.set(key, { f, count: 1 });
      }
    }
    const agreementOf = (c: number): Agreement => (c >= 3 ? '3/3' : c >= 2 ? '2/3' : '1/3');
    return [...groups.values()]
      .map(({ f, count }) => ({ ...f, agreement: agreementOf(count) }))
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
): Promise<{ aggregate: AggregatorOutput; modelsUsed: string[] }> {
  const client = gatewayClient();
  const sysReviewer = buildReviewerSystemPrompt();
  const userReviewer = buildReviewerUserContent(input);
  const reviewCtx = ctx('blog_review');

  const settled = await Promise.allSettled(
    REVIEWER_MODELS.map((m) => chatOnce(client, m, sysReviewer, userReviewer, reviewCtx, 0.15)),
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

  // 리뷰어가 1개뿐이면 집계 불필요(전부 저신뢰).
  if (outputs.length === 1) {
    return { aggregate: wrapSingle(outputs[0].norm), modelsUsed };
  }

  // 집계 LLM — 실패(호출·파싱)하면 규칙 기반 병합으로 폴백해 500 을 피한다.
  try {
    const aggText = await chatOnce(
      client,
      AGGREGATOR_MODEL,
      buildAggregatorSystemPrompt(),
      buildAggregatorUserContent(outputs.map((o) => JSON.stringify(o.norm))),
      reviewCtx,
      0.1,
    );
    const aggregate = normalizeAggregatorOutput(tryParseJsonObject(aggText));
    // 집계가 비었는데 리뷰어엔 findings 가 있으면(모델이 형식만 맞추고 내용 유실) 폴백.
    const aggEmpty = aggregate.medical.length + aggregate.seo.length === 0;
    const hadFindings = outputs.some((o) => o.norm.medical.length + o.norm.seo.length > 0);
    if (aggEmpty && hadFindings) return { aggregate: programmaticMerge(outputs.map((o) => o.norm)), modelsUsed };
    return { aggregate, modelsUsed };
  } catch (e) {
    console.warn('[blog-review] 집계 실패 → 규칙 병합 폴백:', e instanceof Error ? e.message : e);
    return { aggregate: programmaticMerge(outputs.map((o) => o.norm)), modelsUsed };
  }
}
