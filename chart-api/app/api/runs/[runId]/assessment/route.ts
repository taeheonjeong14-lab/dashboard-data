import { NextRequest, NextResponse } from 'next/server';
import { chartAppAuthMiddleware } from '@/lib/chart-app/auth';
import { geminiGenerateText, tryParseJsonObject } from '@/lib/chart-app/gemini';
import { isParseRunUuid } from '@/lib/chart-app/uuid';
import { getChartPgPool } from '@/lib/db';
import { chargeOperationTokens } from '@/lib/billing/token-charge';

async function buildAssessmentSource(pool: ReturnType<typeof getChartPgPool>, runId: string): Promise<string> {
  const { rows: basics } = await pool.query(
    `SELECT * FROM chart_pdf.result_basic_info WHERE parse_run_id = $1::uuid LIMIT 1`,
    [runId],
  );
  const { rows: charts } = await pool.query(
    `SELECT date_time, body_text FROM chart_pdf.result_chart_by_date WHERE parse_run_id = $1::uuid ORDER BY date_time`,
    [runId],
  );
  const { rows: labs } = await pool.query(
    `SELECT item_name, value_text, flag FROM chart_pdf.result_lab_items WHERE parse_run_id = $1::uuid LIMIT 40`,
    [runId],
  );
  return JSON.stringify({ basicInfo: basics[0] ?? null, charts, labs }, null, 0).slice(0, 120_000);
}

// GET /api/runs/{runId}/assessment
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const authErr = chartAppAuthMiddleware(request);
  if (authErr) return authErr;

  const { runId } = await params;
  const id = runId?.trim();
  if (!isParseRunUuid(id)) {
    return NextResponse.json({ error: 'Invalid runId' }, { status: 400 });
  }

  try {
    const pool = getChartPgPool();
    const { rows } = await pool.query<{ ai_assessment: unknown }>(
      'SELECT ai_assessment FROM chart_pdf.parse_runs WHERE id = $1::uuid LIMIT 1',
      [id],
    );

    const row = rows[0];
    if (!row) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ assessment: row.ai_assessment ?? null });
  } catch (e) {
    console.error('GET /api/runs/[runId]/assessment:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

// POST /api/runs/{runId}/assessment — LLM 생성 후 chart_pdf.parse_runs.ai_assessment 저장
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const authErr = chartAppAuthMiddleware(request);
  if (authErr) return authErr;

  const { runId } = await params;
  const id = runId?.trim();
  if (!isParseRunUuid(id)) {
    return NextResponse.json({ error: 'Invalid runId' }, { status: 400 });
  }

  try {
    const pool = getChartPgPool();
    const exists = await pool.query<{ hospital_id: string | null }>(
      `SELECT hospital_id FROM chart_pdf.parse_runs WHERE id = $1::uuid`,
      [id],
    );
    if (exists.rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const hospitalId = exists.rows[0]?.hospital_id ?? null;
    const operationId = crypto.randomUUID();

    let assessmentJson: unknown;
    try {
      const src = await buildAssessmentSource(pool, id!);
      const prompt = `You are a veterinary assistant. Given structured chart extraction JSON, produce a concise clinical assessment JSON object. Output JSON only (no markdown).

Required keys:
- summary (string)
- findings (string[])
- followUps (string[])
- confidence (string)
- conditions (array of objects)

conditions item schema:
- name (string, Korean disease/problem label)
- rationale (string, short evidence)
- confidence (string)

If uncertain, keep conditions as an empty array.

DATA:
${src}`;
      const raw = await geminiGenerateText(prompt, {
        usageContext: { feature: 'assessment', hospitalId, runId: id, operationId },
      });
      assessmentJson = tryParseJsonObject(raw);
      await chargeOperationTokens(hospitalId, operationId, 'assessment');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('GEMINI_API_KEY')) {
        return NextResponse.json({ error: 'LLM not configured (GEMINI_API_KEY)' }, { status: 503 });
      }
      throw err;
    }

    await pool.query(`UPDATE chart_pdf.parse_runs SET ai_assessment = $2::jsonb WHERE id = $1::uuid`, [
      id,
      JSON.stringify(assessmentJson),
    ]);

    return NextResponse.json({ assessment: assessmentJson });
  } catch (e) {
    console.error('POST /api/runs/[runId]/assessment:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
