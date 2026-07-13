/**
 * 건강검진 리포트 "초안(admin 승인본) vs 병원 최종본" 비교 분석 — 초안 프롬프트 개선용.
 *
 * 흐름: admin 이 분석 대상 선택(스냅샷) → 병원이 카카오 발송/공유 PDF 다운로드(= 종료) → 여기서 1회 분석.
 * 비용은 내부 부담 — usage 는 남기되(hospitalId=null) 병원 토큰 차감은 하지 않는다.
 * 저장: health_report.report_draft_diffs
 */
import OpenAI from 'openai';
import type pg from 'pg';
import { getChartPgPool } from '@/lib/db';
import { getHealthCheckupGeneratedContentForRun } from '@/lib/generated-run-content';
import { openaiChatUsage, recordTokenUsage } from '@/lib/billing/usage-log';
import { tryParseJsonObject } from '@/lib/chart-app/gemini';

const GATEWAY_BASE = process.env.AI_GATEWAY_BASE_URL?.trim() || 'https://ai-gateway.vercel.sh/v1';
/** 분석 모델. 게이트웨이 카탈로그 변동 시 env 로 교체(슬러그 확인: /api/debug/blog-review-models). */
const DIFF_MODEL = process.env.REPORT_DIFF_MODEL?.trim() || 'anthropic/claude-haiku-4.5';
const MAX_TOKENS = Number(process.env.REPORT_DIFF_MAX_TOKENS) || 4000;

/** 편집 감지 대상 텍스트 필드(표지 메타는 사실 정정이라 프롬프트 신호가 아님 → 제외). */
const TEXT_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'overallSummary', label: '종합 소견' },
  { key: 'followUpCare', label: '가정 관리' },
  { key: 'labInterpretation', label: '혈액검사 해석' },
  { key: 'recheckWithin1to2Weeks', label: '재검 1~2주' },
  { key: 'recheckWithin1Month', label: '재검 1개월' },
  { key: 'recheckWithin3Months', label: '재검 3개월' },
  { key: 'recheckWithin6Months', label: '재검 6개월' },
];

const BLOCK_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'systemsPage3Blocks', label: '신체검사 3p' },
  { key: 'systemsPage3bBlocks', label: '신체검사 3b' },
  { key: 'systemsPage4Blocks', label: '치과·피부 4p' },
  { key: 'systemsPage5Blocks', label: '영상 5p' },
];

export type DiffEntry = { field: string; label: string; before: string; after: string };

const asText = (v: unknown): string => (typeof v === 'string' ? v : '').trim();

/** 블록 구조(rows variant)를 "필드경로 → 텍스트" 로 펼친다. 이미지 블록은 프롬프트와 무관해 건너뜀. */
function flattenBlocks(key: string, label: string, raw: unknown): Array<{ field: string; label: string; text: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ field: string; label: string; text: string }> = [];
  raw.forEach((block, bi) => {
    const b = block as { variant?: unknown; titleKo?: unknown; rows?: unknown };
    if (b?.variant !== 'rows' || !Array.isArray(b.rows)) return;
    const title = asText(b.titleKo) || `블록${bi + 1}`;
    (b.rows as unknown[]).forEach((row, ri) => {
      const r = row as { label?: unknown; content?: unknown };
      const text = asText(r?.content);
      out.push({
        field: `${key}[${bi}].rows[${ri}]`,
        label: `${label} · ${title} · ${asText(r?.label) || `행${ri + 1}`}`,
        text,
      });
    });
  });
  return out;
}

/** 초안·최종본을 필드 단위로 비교해 "실제로 바뀐 것"만 추린다(LLM 입력을 줄이고 신호를 또렷하게). */
export function diffPayloads(draft: unknown, final: unknown): { changed: DiffEntry[]; unchanged: string[] } {
  const d = (draft ?? {}) as Record<string, unknown>;
  const f = (final ?? {}) as Record<string, unknown>;
  const changed: DiffEntry[] = [];
  const unchanged: string[] = [];

  for (const { key, label } of TEXT_FIELDS) {
    const before = asText(d[key]);
    const after = asText(f[key]);
    if (before === after) {
      if (before) unchanged.push(label);
      continue;
    }
    changed.push({ field: key, label, before, after });
  }

  for (const { key, label } of BLOCK_FIELDS) {
    const beforeRows = flattenBlocks(key, label, d[key]);
    const afterRows = flattenBlocks(key, label, f[key]);
    const afterByField = new Map(afterRows.map((r) => [r.field, r]));
    for (const row of beforeRows) {
      const after = afterByField.get(row.field);
      // 최종본에서 사라진 행(구조 변경)은 after 를 빈 문자열로 둔다.
      const afterText = after?.text ?? '';
      if (row.text === afterText) {
        if (row.text) unchanged.push(row.label);
        continue;
      }
      changed.push({ field: row.field, label: row.label, before: row.text, after: afterText });
    }
  }

  return { changed, unchanged };
}

function gatewayClient(): OpenAI {
  const apiKey = process.env.AI_GATEWAY_API_KEY?.trim();
  if (!apiKey) throw new Error('AI_GATEWAY_API_KEY is not configured');
  return new OpenAI({ apiKey, baseURL: GATEWAY_BASE });
}

const SYSTEM_PROMPT = `당신은 동물병원 건강검진 리포트의 AI 초안 품질을 개선하는 프롬프트 엔지니어입니다.

주어진 것: AI 가 만든 초안(BEFORE)을 수의사가 실제로 고쳐 보호자에게 내보낸 최종본(AFTER). 필드별로 짝지어 줍니다.

# 할 일
- 각 변경에 대해: 무엇이 어떻게 바뀌었는지, 수의사가 왜 고쳤을지(추정), 초안 프롬프트를 어떻게 바꾸면 이 수정이 애초에 필요 없었을지.
- 변경 유형(kind)을 분류: 'factual'(사실·수치 오류 정정) | 'tone'(말투·표현) | 'detail'(내용 추가·삭제) | 'format'(구성·길이) | 'trivial'(오타·공백 등 무의미).
- 마지막에 전체를 관통하는 프롬프트 개선 제안(promptSuggestions)을 우선순위 순으로 최대 5개.

# 규칙
- trivial 한 변경(공백·줄바꿈·조사)은 kind='trivial' 로 표시하고 제안은 만들지 말 것.
- 근거 없는 추측 금지. 왜 고쳤는지 불확실하면 reason 에 "불명확"이라고 쓸 것.
- 모든 문장은 한국어, 개조식 한 구절(대략 40자 이내). 완결 문장으로 늘려 쓰지 말 것.
- promptSuggestions 는 "초안 프롬프트에 넣을 지시문" 형태로 구체적으로. 예: "혈액검사 해석에 정상 항목 나열 금지 — 이상치만 서술".

# 출력 — JSON only
{ "changes":[{"field":"...","kind":"factual","what":"...","reason":"...","promptFix":"..."}],
  "promptSuggestions":["...","..."],
  "summary":"한 문장 총평" }`;

function buildUserContent(changed: DiffEntry[], unchanged: string[]): string {
  const blocks = changed
    .map(
      (c, i) =>
        `## 변경 ${i + 1} — ${c.label} (field: ${c.field})\n[BEFORE — AI 초안]\n${c.before || '(없음)'}\n\n[AFTER — 병원 최종본]\n${c.after || '(삭제됨)'}`,
    )
    .join('\n\n');
  const kept = unchanged.length ? `\n\n손대지 않은 필드(초안 그대로 나감): ${unchanged.join(', ')}` : '';
  return `${blocks}${kept}\n\n---\n위 변경들을 규칙대로 분석해 지정된 JSON 형식으로만 출력하세요.`;
}

async function analyzeWithLlm(
  changed: DiffEntry[],
  unchanged: string[],
  runId: string,
): Promise<unknown> {
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
    // 내부 비용 — hospitalId 를 비워 병원 토큰 차감(operation 합산) 대상에서 제외한다.
    await recordTokenUsage({
      provider: DIFF_MODEL.split('/')[0] ?? DIFF_MODEL,
      model: DIFF_MODEL,
      ...openaiChatUsage((resp as { usage?: unknown }).usage),
      hospitalId: null,
      feature: 'report_draft_diff',
      runId,
    });
  } catch {
    /* 로깅 실패는 무시 */
  }
  return tryParseJsonObject(resp.choices?.[0]?.message?.content ?? '');
}

/** admin 이 분석 대상으로 선택 — 그 시점의 생성 콘텐츠를 초안으로 스냅샷한다. 이미 있으면 스냅샷을 갱신. */
export async function selectRunForDiff(
  runId: string,
  createdBy: string | null,
): Promise<{ ok: true; status: string }> {
  const pool = getChartPgPool();
  const generated = await getHealthCheckupGeneratedContentForRun(null, runId);
  if (!generated) throw new Error('생성된 콘텐츠가 없습니다. 먼저 리포트를 생성해 주세요.');

  const { rows } = await pool.query<{ hospital_id: string | null }>(
    `SELECT hospital_id FROM chart_pdf.parse_runs WHERE id = $1::uuid LIMIT 1`,
    [runId],
  );
  const hospitalId = rows[0]?.hospital_id ?? null;

  // 이미 분석이 끝난 건(done)은 스냅샷을 덮지 않는다(결과 보존).
  const { rows: saved } = await pool.query<{ status: string }>(
    `INSERT INTO health_report.report_draft_diffs (parse_run_id, hospital_id, draft, status, created_by)
     VALUES ($1::uuid, $2::uuid, $3::jsonb, 'selected', $4)
     ON CONFLICT (parse_run_id) DO UPDATE SET
       draft = CASE WHEN health_report.report_draft_diffs.status = 'done'
                    THEN health_report.report_draft_diffs.draft ELSE EXCLUDED.draft END,
       status = CASE WHEN health_report.report_draft_diffs.status = 'done' THEN 'done' ELSE 'selected' END,
       created_by = EXCLUDED.created_by
     RETURNING status`,
    [runId, hospitalId, JSON.stringify(generated.payload), createdBy],
  );
  return { ok: true, status: saved[0]?.status ?? 'selected' };
}

/** admin 이 선택 해제 — 분석 전(selected)일 때만 지운다. 완료분은 결과를 남긴다. */
export async function unselectRunForDiff(runId: string): Promise<{ ok: true; removed: boolean }> {
  const pool = getChartPgPool();
  const res = await pool.query(
    `DELETE FROM health_report.report_draft_diffs WHERE parse_run_id = $1::uuid AND status = 'selected'`,
    [runId],
  );
  return { ok: true, removed: (res.rowCount ?? 0) > 0 };
}

export async function getDiffStatus(runId: string): Promise<{ selected: boolean; status: string | null }> {
  const pool = getChartPgPool();
  const { rows } = await pool.query<{ status: string }>(
    `SELECT status FROM health_report.report_draft_diffs WHERE parse_run_id = $1::uuid LIMIT 1`,
    [runId],
  );
  const status = rows[0]?.status ?? null;
  return { selected: status != null, status };
}

/**
 * 종료 트리거(카카오 발송 / 공유 PDF 다운로드)에서 호출. after() 안에서 돌린다.
 * 선택되지 않았거나 이미 분석된 run 은 조용히 지나간다(경합 시 UPDATE ... WHERE status='selected' 로 1회 보장).
 */
export async function runDiffAnalysisIfSelected(
  runId: string,
  triggeredBy: 'kakao' | 'download',
): Promise<void> {
  let pool: pg.Pool;
  try {
    pool = getChartPgPool();
  } catch {
    return;
  }

  try {
    // 잠금 겸 중복 방지 — selected 인 행만 running 으로 바꾸고, 바꾼 쪽만 분석을 진행한다.
    const claimed = await pool.query<{ draft: unknown }>(
      `UPDATE health_report.report_draft_diffs
          SET status = 'running', triggered_by = $2
        WHERE parse_run_id = $1::uuid AND status = 'selected'
        RETURNING draft`,
      [runId, triggeredBy],
    );
    const draft = claimed.rows[0]?.draft;
    if (!draft) return; // 미선택 또는 이미 처리됨

    const generated = await getHealthCheckupGeneratedContentForRun(null, runId);
    const final = generated?.payload ?? {};
    const { changed, unchanged } = diffPayloads(draft, final);

    // 병원이 한 글자도 안 고쳤으면 LLM 을 부르지 않는다(비용 0, "손 안 댐"도 유의미한 신호).
    const result =
      changed.length === 0
        ? { changes: [], promptSuggestions: [], summary: '병원이 초안을 수정 없이 그대로 발송함.', noEdits: true }
        : await analyzeWithLlm(changed, unchanged, runId);

    await pool.query(
      `UPDATE health_report.report_draft_diffs
          SET status = 'done', final_payload = $2::jsonb, result = $3::jsonb, error = null, analyzed_at = now()
        WHERE parse_run_id = $1::uuid`,
      [runId, JSON.stringify(final), JSON.stringify({ ...(result ?? {}), changed, unchanged })],
    );
  } catch (e) {
    console.error('[report-draft-diff] 분석 실패:', e);
    try {
      await pool.query(
        `UPDATE health_report.report_draft_diffs
            SET status = 'error', error = $2, analyzed_at = now()
          WHERE parse_run_id = $1::uuid`,
        [runId, e instanceof Error ? e.message : String(e)],
      );
    } catch {
      /* 상태 기록 실패는 무시 */
    }
  }
}
