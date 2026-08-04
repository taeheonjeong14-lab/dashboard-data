/**
 * 건강검진 리포트 "초안(admin 승인본) vs 병원 최종본" 비교 분석 — 초안 프롬프트 개선용.
 *
 * 흐름: admin 이 분석 대상 선택(스냅샷) → 병원이 카카오 발송/공유 PDF 다운로드(= 종료) → 여기서 1회 분석.
 * 비용은 내부 부담 — usage 는 남기되(hospitalId=null) 병원 토큰 차감은 하지 않는다.
 * 저장: health_report.report_draft_diffs
 */
import OpenAI from 'openai';
import type pg from 'pg';
import { logError } from '@dashboard/error-log';
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

export type ImageDiffEntry = {
  /** 블록 경로(systemsPage4Blocks[1]). */
  field: string;
  /** 사람이 읽는 이름(치과·피부 4p · 치과 및 안과). */
  label: string;
  /** 초안·최종본에 모두 있는 사진 수. */
  kept: number;
  /** 병원이 새로 넣은 사진 수. */
  added: number;
  /** 병원이 뺀 사진 수. */
  removed: number;
  /** 어떤 파일인지 확인용(각 최대 6개까지만). */
  addedNames: string[];
  removedNames: string[];
};

/** storage 경로에서 파일명만. 비교는 경로 전체로 하되 표시는 짧게. */
function fileNameOf(src: string): string {
  const last = src.split('?')[0].split('/').pop() ?? src;
  return last.length > 48 ? `${last.slice(0, 45)}…` : last;
}

/**
 * 이미지 블록의 초안 vs 최종본 비교. 슬롯 위치가 아니라 **어떤 사진이 쓰였는지(집합)** 로 본다 —
 * 순서만 바뀐 경우까지 "교체"로 세면 신호가 과장된다.
 *
 * 왜 텍스트와 따로 보나: 이미지 선택은 텍스트 프롬프트가 아니라 **비전 모델과 배치 코드**가 한다
 * (c/d 검사소견의 generateCdFindings, a/b 넘침의 selectSectionImages). 병원이 사진을 바꿨다면
 * 그건 "비전이 잘못 골랐다"는 신호라, 텍스트 변경과 섞으면 어느 쪽을 고쳐야 할지 흐려진다.
 */
export function diffBlockImages(draft: unknown, final: unknown): ImageDiffEntry[] {
  const d = (draft ?? {}) as Record<string, unknown>;
  const f = (final ?? {}) as Record<string, unknown>;
  const out: ImageDiffEntry[] = [];

  const srcsOf = (raw: unknown, bi: number): string[] => {
    if (!Array.isArray(raw)) return [];
    const block = raw[bi] as { images?: unknown } | undefined;
    if (!block || !Array.isArray(block.images)) return [];
    return (block.images as unknown[])
      .map((s) => (s && typeof s === 'object' ? (s as { src?: unknown }).src : undefined))
      .filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
  };

  for (const { key, label } of BLOCK_FIELDS) {
    const dRaw = d[key];
    const fRaw = f[key];
    const len = Math.max(Array.isArray(dRaw) ? dRaw.length : 0, Array.isArray(fRaw) ? fRaw.length : 0);
    for (let bi = 0; bi < len; bi += 1) {
      const before = srcsOf(dRaw, bi);
      const after = srcsOf(fRaw, bi);
      if (before.length === 0 && after.length === 0) continue; // 이미지 블록이 아님

      const beforeSet = new Set(before);
      const afterSet = new Set(after);
      const kept = before.filter((s) => afterSet.has(s));
      const removed = before.filter((s) => !afterSet.has(s));
      const added = after.filter((s) => !beforeSet.has(s));
      if (removed.length === 0 && added.length === 0) {
        // 그대로면 기록하지 않는다 — 바뀐 것만 보이게.
        continue;
      }

      // 블록 제목은 같은 섹션의 표(rows) 블록에서 가져온다. 이미지 블록에도 titleKo 가 있지만
      // 실제로는 바로 앞 표 블록의 제목이 그 섹션의 이름이라 그쪽이 읽기 좋다.
      const titleFrom = (raw: unknown): string => {
        if (!Array.isArray(raw)) return '';
        for (let i = bi; i >= 0; i -= 1) {
          const b = raw[i] as { variant?: unknown; titleKo?: unknown } | undefined;
          if (b?.variant === 'rows' && typeof b.titleKo === 'string' && b.titleKo.trim()) return b.titleKo.trim();
        }
        return '';
      };
      const title = titleFrom(fRaw) || titleFrom(dRaw) || `블록${bi + 1}`;

      out.push({
        field: `${key}[${bi}]`,
        label: `${label} · ${title}`,
        kept: kept.length,
        added: added.length,
        removed: removed.length,
        addedNames: added.slice(0, 6).map(fileNameOf),
        removedNames: removed.slice(0, 6).map(fileNameOf),
      });
    }
  }
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

/**
 * 실패(error)한 분석을 손으로 다시 돌린다.
 *
 * 종료 트리거(runDiffAnalysisIfSelected)는 `status='selected'` 인 행만 집어가므로, 한 번 error 가
 * 되면 그 샘플은 영영 재시도되지 않는다. 프롬프트 개선은 샘플이 쌓여야 의미가 있는 기능이라
 * 그대로 두면 조용히 샌다. 자동 재시도는 의도치 않은 비용이 날 수 있어(오늘 403 처럼 원인이
 * 계정 쪽이면 몇 번을 돌려도 실패한다) **사람이 고친 뒤 직접 누르는 방식**으로 둔다.
 *
 * draft 스냅샷은 행에 그대로 남아 있으므로 selected 로 되돌리기만 하면 기존 경로를 그대로 탄다.
 */
export async function retryDiffAnalysis(runId: string): Promise<{ ok: boolean; status: string | null }> {
  const pool = getChartPgPool();
  const { rows } = await pool.query<{ triggered_by: string | null }>(
    `UPDATE health_report.report_draft_diffs
        SET status = 'selected', error = null
      WHERE parse_run_id = $1::uuid AND status = 'error'
      RETURNING triggered_by`,
    [runId],
  );
  if (rows.length === 0) {
    // error 가 아니면 건드리지 않는다(done 결과를 재분석으로 날리지 않기 위해).
    const cur = await getDiffStatus(runId);
    return { ok: false, status: cur.status };
  }
  const triggeredBy = rows[0]?.triggered_by === 'kakao' ? 'kakao' : 'download';
  await runDiffAnalysisIfSelected(runId, triggeredBy);
  const after = await getDiffStatus(runId);
  return { ok: after.status === 'done', status: after.status };
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

  // 실패 로그에 병원을 붙이려고 밖에 둔다(claim 자체가 깨지면 null 로 남는다).
  let hospitalId: string | null = null;

  try {
    // 잠금 겸 중복 방지 — selected 인 행만 running 으로 바꾸고, 바꾼 쪽만 분석을 진행한다.
    const claimed = await pool.query<{ draft: unknown; hospital_id: string | null }>(
      `UPDATE health_report.report_draft_diffs
          SET status = 'running', triggered_by = $2
        WHERE parse_run_id = $1::uuid AND status = 'selected'
        RETURNING draft, hospital_id`,
      [runId, triggeredBy],
    );
    hospitalId = claimed.rows[0]?.hospital_id ?? null;
    const draft = claimed.rows[0]?.draft;
    if (!draft) return; // 미선택 또는 이미 처리됨

    const generated = await getHealthCheckupGeneratedContentForRun(null, runId);
    const final = generated?.payload ?? {};
    const { changed, unchanged } = diffPayloads(draft, final);
    // 이미지 변경은 텍스트와 따로 담는다 — 고칠 대상이 다르다(텍스트 프롬프트 vs 비전 선택).
    const imageDiff = diffBlockImages(draft, final);

    // 병원이 한 글자도 안 고쳤으면 LLM 을 부르지 않는다(비용 0, "손 안 댐"도 유의미한 신호).
    const result =
      changed.length === 0
        ? {
            changes: [],
            promptSuggestions: [],
            // 글자는 그대로여도 사진을 바꿨을 수 있다. 그건 텍스트 프롬프트 신호가 아니라 LLM 을 부르지 않지만,
            // "손 안 댐"으로 뭉뚱그리면 비전 쪽 신호를 놓친다.
            summary:
              imageDiff.length > 0
                ? '본문 텍스트는 그대로 발송했고, 사진만 교체했음.'
                : '병원이 초안을 수정 없이 그대로 발송함.',
            noEdits: true,
          }
        : await analyzeWithLlm(changed, unchanged, runId);

    await pool.query(
      `UPDATE health_report.report_draft_diffs
          SET status = 'done', final_payload = $2::jsonb, result = $3::jsonb, error = null, analyzed_at = now()
        WHERE parse_run_id = $1::uuid`,
      [runId, JSON.stringify(final), JSON.stringify({ ...(result ?? {}), changed, unchanged, imageDiff })],
    );
  } catch (e) {
    console.error('[report-draft-diff] 분석 실패:', e);
    // after() 안에서 도는 백그라운드 작업이라 라우트의 withErrorLog 가 못 본다. 직접 올린다.
    // 안 올리면 실패가 이 run 의 행에만 남아, 프롬프트 개선 화면을 직접 열어봐야만 알 수 있다.
    await logError({
      app: 'chart-api',
      source: 'server',
      route: '/lib/chart-app/report-draft-diff',
      feature: 'report_draft_diff',
      message: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack ?? null : null,
      hospitalId,
      context: { runId, triggeredBy, model: DIFF_MODEL },
    });
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
