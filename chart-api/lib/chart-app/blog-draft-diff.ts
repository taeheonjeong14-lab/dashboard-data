/**
 * 진료케이스 블로그 글 "AI 초안(BEFORE) vs 확정본(AFTER)" 비교 분석 — 초안 프롬프트 개선용.
 *
 * 흐름: 2→3단계에서 blog_post 를 전체 생성할 때마다 BEFORE 를 갱신
 *       → 4단계 검수 후 담당자가 '확정' 을 누르면 그 시점 글을 AFTER 로 두고 1회 분석.
 * 비용은 내부 부담 — usage 는 남기되(hospitalId=null) 병원 토큰 차감은 하지 않는다.
 * 저장: health_report.blog_draft_diffs
 *
 * ★ 이 분석은 **말 표현 변경만** 본다. 정보(전달 내용)가 같은데 텍스트가 바뀐 경우가 표현 변경이고,
 *   정보가 늘거나 줄거나 달라진 편집은 분석 대상이 아니다(content 로 분류만 하고 제안은 만들지 않는다).
 */
import OpenAI from 'openai';
import type pg from 'pg';
import { getChartPgPool } from '@/lib/db';
import { openaiChatUsage, recordTokenUsage } from '@/lib/billing/usage-log';
import { tryParseJsonObject } from '@/lib/chart-app/gemini';

const GATEWAY_BASE = process.env.AI_GATEWAY_BASE_URL?.trim() || 'https://ai-gateway.vercel.sh/v1';
/** 분석 모델. 게이트웨이 카탈로그 변동 시 env 로 교체(슬러그 확인: /api/debug/blog-review-models). */
const DIFF_MODEL = process.env.BLOG_DIFF_MODEL?.trim() || 'anthropic/claude-haiku-4.5';
const MAX_TOKENS = Number(process.env.BLOG_DIFF_MAX_TOKENS) || 4000;

export type BlogDiffEntry = { field: string; label: string; before: string; after: string };

type BlogPostPayload = { title?: unknown; bodyMarkdown?: unknown; tags?: unknown; charCount?: unknown };

const asText = (v: unknown): string => (typeof v === 'string' ? v : '').trim();

/** 마크다운 → 섹션 배열. admin-web lib/blog-sections.ts 의 parseBlogSections 와 같은 규칙(헤딩 1~4단계). */
function parseSections(md: string): Array<{ heading: string; body: string }> {
  const out: Array<{ heading: string; body: string }> = [];
  let cur: { heading: string; body: string } | null = null;
  for (const line of md.split('\n')) {
    const m = /^#{1,4}\s+(.*)$/.exec(line.trim());
    if (m) {
      if (cur) out.push(cur);
      cur = { heading: (m[1] ?? '').trim(), body: '' };
    } else {
      if (!cur) cur = { heading: '', body: '' };
      cur.body += (cur.body ? '\n' : '') + line;
    }
  }
  if (cur) out.push(cur);
  return out.filter((s) => s.heading || s.body.trim());
}

/**
 * 초안·확정본을 제목/태그/본문 섹션 단위로 비교해 "실제로 바뀐 것"만 추린다.
 * 섹션 짝짓기는 순서(index) 기준 — 확정 단계에서 섹션이 통째로 추가·삭제되는 일은 드물고,
 * 제목이 바뀌어도 같은 자리면 같은 섹션으로 보는 편이 표현 변경을 읽기 좋다.
 */
export function diffBlogPosts(draft: unknown, final: unknown): { changed: BlogDiffEntry[]; unchanged: string[] } {
  const d = (draft ?? {}) as BlogPostPayload;
  const f = (final ?? {}) as BlogPostPayload;
  const changed: BlogDiffEntry[] = [];
  const unchanged: string[] = [];

  const dTitle = asText(d.title);
  const fTitle = asText(f.title);
  if (dTitle !== fTitle) changed.push({ field: 'title', label: '제목', before: dTitle, after: fTitle });
  else if (dTitle) unchanged.push('제목');

  const tagText = (v: unknown): string => (Array.isArray(v) ? v.map((t) => asText(t)).filter(Boolean).join(', ') : '');
  const dTags = tagText(d.tags);
  const fTags = tagText(f.tags);
  if (dTags !== fTags) changed.push({ field: 'tags', label: '태그', before: dTags, after: fTags });
  else if (dTags) unchanged.push('태그');

  const dSecs = parseSections(asText(d.bodyMarkdown));
  const fSecs = parseSections(asText(f.bodyMarkdown));
  const n = Math.max(dSecs.length, fSecs.length);
  for (let i = 0; i < n; i += 1) {
    const a = dSecs[i];
    const b = fSecs[i];
    const label = `본문 · ${b?.heading || a?.heading || `섹션${i + 1}`}`;
    // 헤딩과 본문을 한 덩어리로 비교한다(헤딩만 다듬는 것도 표현 변경이라 따로 떼면 신호가 흩어진다).
    const beforeText = a ? [a.heading, a.body.trim()].filter(Boolean).join('\n') : '';
    const afterText = b ? [b.heading, b.body.trim()].filter(Boolean).join('\n') : '';
    if (beforeText === afterText) {
      if (beforeText) unchanged.push(label);
      continue;
    }
    changed.push({ field: `bodyMarkdown[${i}]`, label, before: beforeText, after: afterText });
  }

  return { changed, unchanged };
}

function gatewayClient(): OpenAI {
  const apiKey = process.env.AI_GATEWAY_API_KEY?.trim();
  if (!apiKey) throw new Error('AI_GATEWAY_API_KEY is not configured');
  return new OpenAI({ apiKey, baseURL: GATEWAY_BASE });
}

const SYSTEM_PROMPT = `당신은 동물병원 진료케이스 블로그 글의 AI 초안 품질을 개선하는 프롬프트 엔지니어입니다.

주어진 것: AI 가 쓴 초안(BEFORE)을 담당자가 손봐서 확정한 글(AFTER). 제목·태그·본문 섹션 단위로 짝지어 줍니다.

# 이 분석의 초점 — 말 표현 (가장 중요)
이 분석은 **말 표현(문장·어투·용어 선택)이 어떻게 바뀌었는지**만 봅니다. 내용 자체의 옳고 그름은 보지 않습니다.

- **표현 변경(expression)** = 전달하는 내용은 그대로인데 텍스트가 바뀐 경우. 이것이 분석 대상이다.
  · 어미·문체 (예: "진행했습니다" → "시행하였습니다")
  · 용어 선택 (예: "많이 아팠습니다" → "통증이 심했습니다", 구어체 → 임상 용어)
  · 문장 길이·끊기·어순·리듬, 군더더기 삭제, 중복 표현 정리
  · 문단 나누기·합치기처럼 정보량이 그대로인 구성 변경
- **내용 변경(content)** = 정보가 늘거나 줄거나 달라진 경우. 예: "3일간 입원" → "3일간 입원 치료 후 퇴원"(정보 추가),
  수치·날짜·진단명이 바뀜, 문장이 통째로 추가·삭제됨. **kind='content' 로 표시만 하고 promptFix 는 비운다.**
- 판별 기준은 하나다: **"전달하는 내용이 같은가?"** 같으면 expression, 다르면 content.
- 오타·공백·조사 교정처럼 의미 없는 수정은 kind='trivial'. 제안을 만들지 않는다.

# 할 일
- 각 변경에 대해: 무엇이 어떻게 바뀌었는지(what), 담당자가 왜 그렇게 고쳤을지(reason),
  초안 프롬프트를 어떻게 바꾸면 이 수정이 애초에 필요 없었을지(promptFix).
- 마지막에 **표현 측면에서** 반복되는 경향을 뽑아 프롬프트 개선 제안(promptSuggestions)을 우선순위 순으로 최대 5개.
  · kind='expression' 인 변경들에서만 뽑는다. content/trivial 은 제안 근거로 쓰지 않는다.
  · 예: "문장을 짧게 끊어 쓸 것 — 한 문장에 두 가지 사실을 담지 말 것", "'~하였습니다' 대신 '~했습니다' 로 통일".

# 규칙
- 근거 없는 추측 금지. 왜 고쳤는지 불확실하면 reason 에 "불명확"이라고 쓸 것.
- 모든 문장은 한국어, 개조식 한 구절(대략 40자 이내). 완결 문장으로 늘려 쓰지 말 것.
- promptSuggestions 는 "초안 프롬프트에 넣을 지시문" 형태로 구체적으로 쓸 것.

# 출력 — JSON only
{ "changes":[{"field":"...","kind":"expression","what":"...","reason":"...","promptFix":"..."}],
  "promptSuggestions":["...","..."],
  "summary":"표현 변경 경향 한 문장 총평" }`;

function buildUserContent(changed: BlogDiffEntry[], unchanged: string[]): string {
  const blocks = changed
    .map(
      (c, i) =>
        `## 변경 ${i + 1} — ${c.label} (field: ${c.field})\n[BEFORE — AI 초안]\n${c.before || '(없음)'}\n\n[AFTER — 확정본]\n${c.after || '(삭제됨)'}`,
    )
    .join('\n\n');
  const kept = unchanged.length ? `\n\n손대지 않은 부분(초안 그대로 확정): ${unchanged.join(', ')}` : '';
  return `${blocks}${kept}\n\n---\n위 변경들을 규칙대로 분석해 지정된 JSON 형식으로만 출력하세요.`;
}

async function analyzeWithLlm(changed: BlogDiffEntry[], unchanged: string[], runId: string): Promise<unknown> {
  const client = gatewayClient();
  const resp = await client.chat.completions.create({
    model: DIFF_MODEL,
    temperature: 0.1,
    max_tokens: MAX_TOKENS,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserContent(changed, unchanged) },
    ],
  });
  try {
    // 내부 비용 — hospitalId 를 비워 병원 토큰 차감 대상에서 제외한다.
    await recordTokenUsage({
      provider: DIFF_MODEL.split('/')[0] ?? DIFF_MODEL,
      model: DIFF_MODEL,
      ...openaiChatUsage((resp as { usage?: unknown }).usage),
      hospitalId: null,
      feature: 'blog_draft_diff',
      runId,
    });
  } catch {
    /* 로깅 실패는 무시 */
  }
  return tryParseJsonObject(resp.choices?.[0]?.message?.content ?? '');
}

/**
 * BEFORE 스냅샷 — blog_post 를 **전체 생성**할 때마다 호출(섹션 재생성·간결화에서는 부르지 않는다).
 * 이미 분석이 끝난(done) 건은 덮지 않는다(결과 보존). 확정 전이면 마지막 AI 버전으로 갱신한다.
 * 실패해도 생성 자체는 깨지지 않아야 하므로 호출부에서 삼킨다.
 */
export async function snapshotBlogDraft(runId: string, draft: unknown): Promise<void> {
  const pool = getChartPgPool();
  const { rows } = await pool.query<{ hospital_id: string | null }>(
    `SELECT hospital_id FROM chart_pdf.parse_runs WHERE id = $1::uuid LIMIT 1`,
    [runId],
  );
  const hospitalId = rows[0]?.hospital_id ?? null;

  await pool.query(
    `INSERT INTO health_report.blog_draft_diffs (parse_run_id, hospital_id, draft, status)
     VALUES ($1::uuid, $2::uuid, $3::jsonb, 'draft')
     ON CONFLICT (parse_run_id) DO UPDATE SET
       draft  = CASE WHEN health_report.blog_draft_diffs.status = 'done'
                     THEN health_report.blog_draft_diffs.draft ELSE EXCLUDED.draft END,
       status = CASE WHEN health_report.blog_draft_diffs.status = 'done' THEN 'done' ELSE 'draft' END`,
    [runId, hospitalId, JSON.stringify(draft ?? {})],
  );
}

/**
 * 확정 트리거에서 호출. 초안이 없거나 이미 분석된 run 은 조용히 지나간다
 * (경합 시 UPDATE ... WHERE status='draft' 로 1회 보장).
 */
export async function runBlogDiffAnalysisOnConfirm(runId: string, finalPayload: unknown): Promise<void> {
  let pool: pg.Pool;
  try {
    pool = getChartPgPool();
  } catch {
    return;
  }

  try {
    const claimed = await pool.query<{ draft: unknown }>(
      `UPDATE health_report.blog_draft_diffs
          SET status = 'running'
        WHERE parse_run_id = $1::uuid AND status = 'draft'
        RETURNING draft`,
      [runId],
    );
    const draft = claimed.rows[0]?.draft;
    if (!draft) return; // 초안 스냅샷 없음 또는 이미 처리됨

    const { changed, unchanged } = diffBlogPosts(draft, finalPayload);

    // 한 글자도 안 고쳤으면 LLM 을 부르지 않는다(비용 0, "손 안 댐"도 유의미한 신호).
    const result =
      changed.length === 0
        ? { changes: [], promptSuggestions: [], summary: 'AI 초안을 수정 없이 그대로 확정함.', noEdits: true }
        : await analyzeWithLlm(changed, unchanged, runId);

    await pool.query(
      `UPDATE health_report.blog_draft_diffs
          SET status = 'done', final_payload = $2::jsonb, result = $3::jsonb, error = null, analyzed_at = now()
        WHERE parse_run_id = $1::uuid`,
      [runId, JSON.stringify(finalPayload ?? {}), JSON.stringify({ ...(result ?? {}), changed, unchanged })],
    );
  } catch (e) {
    console.error('[blog-draft-diff] 분석 실패:', e);
    try {
      await pool.query(
        `UPDATE health_report.blog_draft_diffs
            SET status = 'error', error = $2, analyzed_at = now()
          WHERE parse_run_id = $1::uuid`,
        [runId, e instanceof Error ? e.message : String(e)],
      );
    } catch {
      /* 상태 기록 실패는 무시 */
    }
  }
}
