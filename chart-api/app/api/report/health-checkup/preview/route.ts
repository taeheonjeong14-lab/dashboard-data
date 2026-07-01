import { NextRequest, NextResponse } from 'next/server';
import { chartAppAuthMiddleware } from '@/lib/chart-app/auth';
import { isParseRunUuid } from '@/lib/chart-app/uuid';
import { getChartPgPool } from '@/lib/db';
import { loadReportSourceData } from '@/lib/chart-app/report-source';
import { buildHealthReportPreviewModel } from '@/lib/chart-app/health-report-preview-model';
import { parseHealthCheckupPayloadFromStorage } from '@/lib/chart-app/health-checkup-content-llm';
import { hospitalRowFromDb } from '@/lib/chart-app/hospital-db';
import { signImageSlotsInBlocks } from '@/lib/chart-app/health-report-blocks-sign-images';

const HEALTH = 'health_checkup';

async function loadHospital(pool: ReturnType<typeof getChartPgPool>, hospitalId: unknown) {
  if (hospitalId == null) return null;
  const { rows } = await pool.query(
    `
    SELECT *
    FROM core.hospitals
    WHERE id::text = $1
    LIMIT 1
    `,
    [String(hospitalId)],
  );
  return hospitalRowFromDb(rows[0] ?? null);
}

// POST /api/report/health-checkup/preview
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
  if (!isParseRunUuid(runId)) return NextResponse.json({ error: 'runId invalid' }, { status: 400 });

  try {
    const pool = getChartPgPool();
    const pr = await pool.query<{ hospital_id: string | null }>(
      `SELECT hospital_id FROM chart_pdf.parse_runs WHERE id = $1::uuid LIMIT 1`,
      [runId],
    );
    if (pr.rows.length === 0) return NextResponse.json({ error: 'run not found' }, { status: 404 });

    const hospital = await loadHospital(pool, pr.rows[0].hospital_id);

    const source = await loadReportSourceData(runId);

    const { rows } = await pool.query<{ payload: unknown; updated_at: Date }>(
      `
      SELECT payload, updated_at
      FROM health_report.generated_run_content
      WHERE parse_run_id = $1::uuid AND content_type = $2
      LIMIT 1
      `,
      [runId, HEALTH],
    );
    const row = rows[0];
    const rawPayload = body.generatedPayload !== undefined && body.generatedPayload !== null ? body.generatedPayload : row?.payload;
    const updatedAt = row?.updated_at?.toISOString?.() ?? new Date().toISOString();

    if (!rawPayload) return NextResponse.json({ error: '생성 결과 없음' }, { status: 404 });

    const generated = parseHealthCheckupPayloadFromStorage(rawPayload);
    // 화면 미리보기는 글자수 초과분도 끝까지 보이도록 clamp 끔(PDF 인쇄 때만 각 칸 max 로 잘림).
    const model = buildHealthReportPreviewModel({ source, generated, hospital, clamp: false });
    await Promise.all([
      signImageSlotsInBlocks(model.systemsPage4Blocks),
      signImageSlotsInBlocks(model.systemsPage5Blocks),
    ]);

    return NextResponse.json({ runId, updatedAt, model });
  } catch (e) {
    console.error('POST health-checkup preview:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
