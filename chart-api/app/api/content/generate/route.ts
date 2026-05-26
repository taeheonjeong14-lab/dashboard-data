import { NextRequest, NextResponse } from 'next/server';
import { chartAppAuthMiddleware } from '@/lib/chart-app/auth';
import { geminiGenerateText, tryParseJsonObject } from '@/lib/chart-app/gemini';
import {
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

    if (contentType === BLOG_POST) {
      try {
        const refs = body.referenceMaterials ? JSON.stringify(body.referenceMaterials).slice(0, 50_000) : '';
        const sourceText = JSON.stringify(source).slice(0, 120_000);
        const prompt = `Write a Korean vet-blog draft as JSON only with keys: title, excerpt, bodyMarkdown, tags (string[]).
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
