import { NextRequest, NextResponse } from 'next/server';
import { chartAppAuthMiddleware } from '@/lib/chart-app/auth';
import { geminiGenerateText, tryParseJsonObject } from '@/lib/chart-app/gemini';
import {
  getGeneratedByType,
  getHealthCheckupGeneratedContentForRun,
  upsertGeneratedRunContent,
} from '@/lib/chart-app/generated-content';
import {
  generateHealthCheckupContent,
  generateHealthCheckupSection,
  isRegenerateSection,
  HEALTH_CHECKUP_COVER_STORAGE_KEYS,
  parseHealthCheckupPayloadFromStorage,
  type HealthCheckupGeneratedContent,
} from '@/lib/chart-app/health-checkup-content-llm';
import { validateHealthCheckupGeneratedContent } from '@/lib/chart-app/health-checkup-content-schema';
import {
  applyImagePlacementForSection,
  runImagePlacementForRun,
} from '@/lib/chart-app/health-report-image-placement-run';
import { isParseRunUuid } from '@/lib/chart-app/uuid';
import { getChartPgPool } from '@/lib/db';
import { applyHealthCheckupCoverFromSource } from '@/lib/chart-app/health-checkup-cover-from-source';
import { loadReportSourceData } from '@/lib/chart-app/report-source';

const HEALTH_CHECKUP = 'health_checkup';
const BLOG_POST = 'blog_post';
const BLOG_STORYLINE = 'blog_storyline';

type GenerateDebugInfo = {
  enabled: boolean;
  parser: {
    rawLength: number;
    repaired: boolean;
    repairRawLength?: number;
    parseError?: string;
    repairError?: string;
  };
  model: {
    maxOutputTokens: number;
  };
};

function isDebugEnabled(body: Record<string, unknown>): boolean {
  const reqDebug = body.debug;
  if (typeof reqDebug === 'boolean') return reqDebug;
  const envDebug = (process.env.CHART_APP_DEBUG_CONTENT_GENERATE ?? '').trim().toLowerCase();
  return envDebug === '1' || envDebug === 'true';
}

async function parseJsonWithRepair(raw: string, schemaHint: string): Promise<{ parsed: unknown; debug: GenerateDebugInfo['parser'] }> {
  const parserDebug: GenerateDebugInfo['parser'] = {
    rawLength: raw.length,
    repaired: false,
  };
  try {
    return { parsed: tryParseJsonObject(raw), debug: parserDebug };
  } catch (firstErr) {
    parserDebug.parseError = firstErr instanceof Error ? firstErr.message : String(firstErr);
    const repairPrompt = [
      'You are a JSON repair tool.',
      'Fix the following malformed JSON and return JSON only.',
      `Required shape hint: ${schemaHint}`,
      'Rules:',
      '- Keep original meaning.',
      '- Do not add markdown fences or commentary.',
      '- Ensure valid JSON parseable by JSON.parse.',
      '',
      'Malformed JSON:',
      raw.slice(0, 120_000),
    ].join('\n');
    const repaired = await geminiGenerateText(repairPrompt, { maxOutputTokens: 8192 });
    parserDebug.repaired = true;
    parserDebug.repairRawLength = repaired.length;
    try {
      return { parsed: tryParseJsonObject(repaired), debug: parserDebug };
    } catch (repairErr) {
      parserDebug.repairError = repairErr instanceof Error ? repairErr.message : String(repairErr);
      throw repairErr;
    }
  }
}

// POST /api/content/generate — contentType 분기
export async function POST(request: NextRequest) {
  const authErr = chartAppAuthMiddleware(request);
  if (authErr) return authErr;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const runId = String(body.runId ?? '').trim();
  const contentType = String(body.contentType ?? '').trim();
  const debugEnabled = isDebugEnabled(body);
  const maxOutputTokens = 8192;
  if (!isParseRunUuid(runId)) return NextResponse.json({ error: 'runId invalid' }, { status: 400 });

  const pool = getChartPgPool();
  const runOk = await pool.query(`SELECT 1 FROM chart_pdf.parse_runs WHERE id = $1::uuid`, [runId]);
  if (runOk.rows.length === 0) return NextResponse.json({ error: 'run not found' }, { status: 404 });

  try {
    const source = await loadReportSourceData(runId);

    if (contentType === HEALTH_CHECKUP) {
      const sectionRaw = typeof body.section === 'string' ? body.section.trim() : '';
      if (sectionRaw) {
        if (!isRegenerateSection(sectionRaw)) {
          return NextResponse.json({ error: `invalid section: ${sectionRaw}` }, { status: 400 });
        }
        try {
          const checkupDate = typeof body.checkupDate === 'string' ? body.checkupDate.trim() : '';
          const must = typeof body.mustInclude === 'string' ? body.mustInclude.trim().slice(0, 1000) : '';
          const prior = await getHealthCheckupGeneratedContentForRun(pool, runId);
          const priorPayload = parseHealthCheckupPayloadFromStorage(prior?.payload ?? {});
          const coverProgramFromBody = typeof body.coverProgram === 'string' ? body.coverProgram.trim() : '';
          const reportProgramForPrompt =
            coverProgramFromBody ||
            (typeof priorPayload.coverProgram === 'string' ? priorPayload.coverProgram.trim() : '') ||
            '';
          const partial = await generateHealthCheckupSection(sectionRaw, source, {
            reportProgramName: reportProgramForPrompt || undefined,
            checkupDate: checkupDate || undefined,
            mustInclude: must || undefined,
          });

          // 이미지 페이지(치과·피부 / 방사선·초음파)는 텍스트만 재생성하면 이미지 슬롯이 빈
          // 데모 블록으로 덮인다. 현재 run 의 케이스 이미지(나중에 추가된 것 포함)를 다시 배치한다.
          if (sectionRaw === 'systems4' || sectionRaw === 'systems5') {
            const blocksKey = sectionRaw === 'systems4' ? 'systemsPage4Blocks' : 'systemsPage5Blocks';
            const partialRecord = partial as Record<string, unknown>;
            try {
              partialRecord[blocksKey] = await applyImagePlacementForSection(
                pool,
                runId,
                sectionRaw,
                partialRecord[blocksKey],
              );
            } catch (placementErr) {
              console.error('[content/generate] section image placement failed (non-blocking):', placementErr);
            }
          }

          return NextResponse.json({ runId, contentType, section: sectionRaw, generated: partial, saved: false });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes('GEMINI_API_KEY')) {
            return NextResponse.json({ error: 'LLM not configured (GEMINI_API_KEY)' }, { status: 503 });
          }
          console.error('[content/generate] section regen error:', e);
          return NextResponse.json({ error: msg }, { status: 500 });
        }
      }

      try {
        const prior = await getHealthCheckupGeneratedContentForRun(pool, runId);
        const priorPayload = parseHealthCheckupPayloadFromStorage(prior?.payload ?? {});
        const coverProgramFromBody =
          typeof body.coverProgram === 'string' ? body.coverProgram.trim() : '';
        const reportProgramForPrompt =
          coverProgramFromBody || (typeof priorPayload.coverProgram === 'string' ? priorPayload.coverProgram.trim() : '') || '';
        const checkupDate = typeof body.checkupDate === 'string' ? body.checkupDate.trim() : '';
        const veterinarian = typeof body.veterinarian === 'string' ? body.veterinarian.trim() : '';
        const must =
          typeof body.mustInclude === 'string' ? body.mustInclude.trim().slice(0, 1000) : '';
        const generated = await generateHealthCheckupContent(source, {
          reportProgramName: reportProgramForPrompt || undefined,
          checkupDate: checkupDate || undefined,
          veterinarian: veterinarian || undefined,
          mustInclude: must || undefined,
        });

        /** 표지 merge 순서(vet-report POST /api/content/generate 와 동일 개념): generated → 이전 저장(키별 undefined 아닌 값만) → 요청 checkupDate/veterinarian 덮어쓰기 → 요청 coverProgram 비어 있지 않으면 표지 프로그램 덮어쓰기 → applyHealthCheckupCoverFromSource 로 DB 기본값은 null/undefined 만 채움. */
        const coverPreserve: Partial<HealthCheckupGeneratedContent> = {};
        for (const key of HEALTH_CHECKUP_COVER_STORAGE_KEYS) {
          const v = priorPayload[key];
          if (v !== undefined) coverPreserve[key] = v;
        }

        const merged: HealthCheckupGeneratedContent = {
          ...generated,
          ...coverPreserve,
          ...(checkupDate ? { coverCheckupDate: checkupDate } : {}),
          ...(veterinarian ? { coverVeterinarian: veterinarian } : {}),
        };
        if (coverProgramFromBody) merged.coverProgram = coverProgramFromBody;

        const withSourceCover = applyHealthCheckupCoverFromSource(merged, source);
        const payload = parseHealthCheckupPayloadFromStorage(withSourceCover);
        const validated = validateHealthCheckupGeneratedContent(payload, { runId });
        if (!validated.ok) {
          console.warn('[POST /api/content/generate] validation failed', {
            runId,
            error: validated.error,
            coverSnapshot: HEALTH_CHECKUP_COVER_STORAGE_KEYS.map((k) => [
              k,
              typeof (payload as Record<string, unknown>)[k],
            ]),
          });
          return NextResponse.json({ error: validated.error }, { status: 422 });
        }
        try {
          await runImagePlacementForRun(pool, runId, validated.value);
        } catch (placementErr) {
          console.error('[content/generate] image placement failed (non-blocking):', placementErr);
        }

        const parserDebug: GenerateDebugInfo['parser'] = {
          rawLength: JSON.stringify(source).length,
          repaired: false,
        };
        const saved = await upsertGeneratedRunContent(pool, runId, HEALTH_CHECKUP, validated.value);
        const debug: GenerateDebugInfo | undefined = debugEnabled
          ? {
              enabled: true,
              parser: parserDebug,
              model: { maxOutputTokens },
            }
          : undefined;
        return NextResponse.json({
          runId,
          contentType,
          generated: validated.value,
          source,
          resultCode: 'OK',
          saved,
          ...(debug ? { debug } : {}),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('GEMINI_API_KEY')) {
          return NextResponse.json({ error: 'LLM not configured (GEMINI_API_KEY)' }, { status: 503 });
        }
        throw e;
      }
    }

    // 진료케이스 스토리라인 — 차트(PDF)+케이스 개요(blog_case)로 글의 아웃라인을 생성.
    // 저장하지 않고 반환(사용자가 모달에서 검토·수정 후 blog_post 생성 시 입력으로 전달).
    if (contentType === BLOG_STORYLINE) {
      try {
        // 유저가 hospital-ui에서 작성한 케이스 개요(blog_case)
        const blogCase = await getGeneratedByType(pool, runId, 'blog_case');
        const rawOverview =
          (blogCase?.payload as { overview?: Record<string, unknown> } | null)?.overview ?? {};
        const overviewLabels: { key: string; label: string }[] = [
          { key: 'final_diagnosis', label: '최종 진단명' },
          { key: 'visit_background', label: '내원 배경' },
          { key: 'patient_notes', label: '환자 특이사항' },
          { key: 'diagnosis_method', label: '진단 방식' },
          { key: 'treatment_process', label: '치료 과정' },
          { key: 'aftercare_plan', label: '사후 관리 계획' },
          { key: 'emphasis', label: '강조 희망 사항' },
        ];
        // 전체 항목(빈 값 포함) — 모달에서 미작성 칸을 빨간색 경고로 표시하기 위함.
        const caseOverview = overviewLabels.map(({ key, label }) => ({
          label,
          value: String((rawOverview as Record<string, unknown>)[key] ?? '').trim(),
        }));
        const filled = caseOverview.filter((x) => x.value);
        const caseOverviewText = filled.length
          ? filled.map((x) => `- ${x.label}: ${x.value}`).join('\n')
          : '(작성된 케이스 개요 없음)';

        const sourceText = JSON.stringify(source).slice(0, 120_000);
        const prompt = [
          '당신은 동물병원을 운영하는 수의사이자 병원 원장입니다.',
          '목적: 당신의 병원을 네이버에서 홍보하기 위해, 병원 블로그에 실제 진행되었던 진료 사례를 소개하는 글을 작성하려 합니다.',
          '',
          '지금은 [1단계 — 스토리라인(아웃라인) 작성] 단계입니다.',
          '무작정 글을 쓰면 내용이 중구난방이 될 수 있으므로, 먼저 주어진 자료를 토대로 글의 아웃라인을 정리하는 것이 목적입니다.',
          '',
          '[입력 자료]',
          '1) PDF 추출 자료 — 날짜별 차트 본문, 혈액검사 결과 등 (아래 CHART_SOURCE).',
          '2) 케이스 개요 — 병원 담당자가 직접 작성한 내용(최종 진단명 ~ 강조 희망 사항) (아래 CASE_OVERVIEW).',
          '3) 업로드된 이미지 자료 — 단, 이미지 분석은 부정확할 수 있으니 적극적으로 활용하지 말 것.',
          '→ 1)과 2)를 위주로 활용하세요.',
          '',
          '[작성 구조]',
          '아래 5개 파트로 나누고, 각 파트마다 세 가지(a/b/c)를 정리하세요.',
          '- a. summary: 한 줄 요약',
          '- b. facts: 이 파트에서 반드시 언급되어야 하는, 케이스 관련 실제 팩트 (문자열 배열)',
          '- c. emphasis: 이 파트에서 강조되어야 하는 내용 (문자열 배열)',
          '',
          '5개 파트:',
          '1) 내원 배경(visit): 이 환자가 어떤 증상으로/어떤 목적으로 병원에 오게 되었는지',
          '2) 진단 과정(diagnosis): 케이스에서 설명하려는 질환을 어떤 검사 과정을 통해 진단했는지',
          '3) 치료 과정(treatment): 그 질환을 어떻게 치료했는지',
          '4) 사후 관리 방안(aftercare): 진료를 마치며 원장이 보호자에게 재발 방지를 위해 알려준 관리법',
          '5) 원장님 한마디(message): 원장이 이번 케이스에서 독자에게 꼭 전하고 싶은 말',
          '',
          '[반드시 지킬 것]',
          '- 없는 사실을 절대 만들어내지 말 것. 오직 주어진 입력 자료(PDF 추출 자료, 케이스 개요) 안의 내용만 사용한다.',
          '- 케이스 개요(CASE_OVERVIEW)에 있는 내용은 반드시 모두 어딘가에 언급/반영할 것.',
          '- 실제 진료 사례이므로 입력 자료의 팩트를 최대한 활용할 것.',
          '- 한국어로 작성.',
          '',
          '[출력 형식] JSON only:',
          '{ "parts": [',
          '  { "key": "visit", "title": "내원 배경", "summary": string, "facts": string[], "emphasis": string[] },',
          '  { "key": "diagnosis", "title": "진단 과정", "summary": string, "facts": string[], "emphasis": string[] },',
          '  { "key": "treatment", "title": "치료 과정", "summary": string, "facts": string[], "emphasis": string[] },',
          '  { "key": "aftercare", "title": "사후 관리 방안", "summary": string, "facts": string[], "emphasis": string[] },',
          '  { "key": "message", "title": "원장님 한마디", "summary": string, "facts": string[], "emphasis": string[] }',
          '] }',
          '',
          'CASE_OVERVIEW:',
          caseOverviewText,
          '',
          'CHART_SOURCE:',
          sourceText,
        ].join('\n');

        const raw = await geminiGenerateText(prompt, { maxOutputTokens });
        const { parsed, debug: parserDebug } = await parseJsonWithRepair(
          raw,
          'object with key parts: array of { key, title, summary, facts: string[], emphasis: string[] }',
        );
        const parts = (parsed as { parts?: unknown }).parts ?? [];
        const debug: GenerateDebugInfo | undefined = debugEnabled
          ? { enabled: true, parser: parserDebug, model: { maxOutputTokens } }
          : undefined;
        // 저장하지 않음 — 케이스 개요(유저 입력 그대로)와 파트(아웃라인)를 함께 반환.
        return NextResponse.json({
          runId,
          contentType,
          generated: { caseOverview, parts },
          payload: { caseOverview, parts },
          saved: false,
          ...(debug ? { debug } : {}),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('GEMINI_API_KEY')) {
          return NextResponse.json({ error: 'LLM not configured (GEMINI_API_KEY)' }, { status: 503 });
        }
        throw e;
      }
    }

    if (contentType === BLOG_POST) {
      try {
        const refs = body.referenceMaterials ? JSON.stringify(body.referenceMaterials).slice(0, 50_000) : '';
        const storyline = typeof body.storyline === 'string' ? body.storyline.trim().slice(0, 20_000) : '';
        const sourceText = JSON.stringify(source).slice(0, 120_000);
        const prompt = storyline
          ? [
              '아래 "스토리라인"을 토대로 동물병원 블로그 진료케이스 글을 한국어로 작성하세요.',
              '- 스토리라인의 흐름·강조점을 충실히 따르되, 자연스러운 블로그 문체로 풀어쓰기',
              '- 환자·보호자 식별정보는 일반화, 과장·허위 금지(차트 사실 범위)',
              'JSON only with keys: title, excerpt, bodyMarkdown, tags (string[]).',
              '',
              '스토리라인:',
              storyline,
              '',
              '참고용 차트 컨텍스트:',
              sourceText,
              refs ? `\nReferenceMaterials:${refs}` : '',
            ].join('\n')
          : `Write a Korean vet-blog draft as JSON only with keys: title, excerpt, bodyMarkdown, tags (string[]).
Run medical chart context:\n${sourceText}\n\nReferenceMaterials:${refs}`;
        const raw = await geminiGenerateText(prompt, { maxOutputTokens });
        const { parsed: generated, debug: parserDebug } = await parseJsonWithRepair(
          raw,
          'object with keys: title (string), excerpt (string), bodyMarkdown (string), tags (string[])',
        );
        const saved = await upsertGeneratedRunContent(pool, runId, BLOG_POST, generated);
        const debug: GenerateDebugInfo | undefined = debugEnabled
          ? {
              enabled: true,
              parser: parserDebug,
              model: { maxOutputTokens },
            }
          : undefined;
        return NextResponse.json({
          runId,
          contentType,
          source,
          generated,
          payload: generated,
          saved,
          ...(debug ? { debug } : {}),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('GEMINI_API_KEY')) {
          return NextResponse.json({ error: 'LLM not configured (GEMINI_API_KEY)' }, { status: 503 });
        }
        throw e;
      }
    }

    return NextResponse.json({ error: `unsupported contentType: ${contentType}` }, { status: 400 });
  } catch (e) {
    console.error('POST /api/content/generate:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
