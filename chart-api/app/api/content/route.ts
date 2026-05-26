import { NextRequest, NextResponse } from 'next/server';
import { chartAppAuthMiddleware } from '@/lib/chart-app/auth';
import { upsertGeneratedRunContent } from '@/lib/chart-app/generated-content';
import { validateHealthCheckupGeneratedContent } from '@/lib/chart-app/health-checkup-content-schema';
import { isParseRunUuid } from '@/lib/chart-app/uuid';
import { getChartPgPool } from '@/lib/db';
import { parseHealthCheckupPayloadFromStorage } from '@/lib/chart-app/health-checkup-content-llm';

type ContentRow = {
  id: string;
  content_type: string;
  payload: unknown;
  created_at: Date;
  updated_at: Date;
};

const HEALTH_CHECKUP = 'health_checkup';

// GET /api/content?runId=
export async function GET(request: NextRequest) {
  const authErr = chartAppAuthMiddleware(request);
  if (authErr) return authErr;

  const runId = new URL(request.url).searchParams.get('runId')?.trim();
  if (!runId || !isParseRunUuid(runId)) {
    return NextResponse.json({ error: 'runId query parameter must be a valid UUID' }, { status: 400 });
  }

  try {
    const pool = getChartPgPool();
    const { rows } = await pool.query<ContentRow>(
      `
      SELECT id, content_type, payload, created_at, updated_at
      FROM health_report.generated_run_content
      WHERE parse_run_id = $1::uuid
      ORDER BY created_at DESC
      `,
      [runId],
    );

    const items = rows.map((r) => {
      let payload = r.payload;
      if (r.content_type === HEALTH_CHECKUP) {
        // 1) parse(저장 형태 정규화) → 2) validate(표지 키 유지 포함)
        // recheck 필드는 빈 문자열을 그대로 보존한다(사용자가 비워둔 시기는 빈칸으로).
        const parsed = parseHealthCheckupPayloadFromStorage(r.payload);
        const validated = validateHealthCheckupGeneratedContent(parsed, { runId });
        if (!validated.ok) {
          throw new Error(`invalid stored health_checkup payload: ${validated.error}`);
        }
        payload = validated.value;
      }
      return {
        id: r.id,
        contentType: r.content_type,
        payload,
        createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
        updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
      };
    });

    return NextResponse.json({ runId, items });
  } catch (e) {
    console.error('GET /api/content:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

// PATCH /api/content — 페이로드 upsert
export async function PATCH(request: NextRequest) {
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
  if (!isParseRunUuid(runId)) return NextResponse.json({ error: 'runId invalid' }, { status: 400 });
  if (!contentType) return NextResponse.json({ error: 'contentType required' }, { status: 400 });
  if (contentType === HEALTH_CHECKUP) {
    const validated = validateHealthCheckupGeneratedContent(body.payload, { runId });
    if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 422 });
    body.payload = validated.value;
  }

  try {
    const pool = getChartPgPool();
    const exists = await pool.query(`SELECT 1 FROM chart_pdf.parse_runs WHERE id = $1::uuid`, [runId]);
    if (exists.rows.length === 0) return NextResponse.json({ error: 'run not found' }, { status: 404 });

    const saved = await upsertGeneratedRunContent(pool, runId, contentType, body.payload);
    return NextResponse.json({ ok: true, saved });
  } catch (e) {
    console.error('PATCH /api/content:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

// DELETE /api/content — 단건 삭제
export async function DELETE(request: NextRequest) {
  const authErr = chartAppAuthMiddleware(request);
  if (authErr) return authErr;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const runId = String(body.runId ?? '').trim();
  const id = String(body.id ?? '').trim();
  if (!isParseRunUuid(runId)) return NextResponse.json({ error: 'runId invalid' }, { status: 400 });
  if (!isParseRunUuid(id)) return NextResponse.json({ error: 'id invalid' }, { status: 400 });

  try {
    const pool = getChartPgPool();
    const del = await pool.query(
      `DELETE FROM health_report.generated_run_content WHERE id = $1::uuid AND parse_run_id = $2::uuid`,
      [id, runId],
    );
    if (del.rowCount === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('DELETE /api/content:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
