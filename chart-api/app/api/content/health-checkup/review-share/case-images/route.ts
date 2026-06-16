import { NextRequest, NextResponse } from 'next/server';
import { hashShareToken } from '@/lib/chart-app/share-token';
import { getChartPgPool } from '@/lib/db';
import { signCaseImageStoragePaths } from '@/lib/chart-app/image-case-signing';
import { applyPublicShareReviewCors, sharePublicCorsHeadersSnapshot } from '@/lib/chart-app/share-public-cors';

export const runtime = 'nodejs';

const LINK_CONTENT_TYPE = 'health_checkup';
const LEGACY_LINK_CONTENT_TYPE = 'health-checkup';
const GENERATED_CONTENT_TYPE = 'health_checkup';

type CaseImageRow = {
  id: string;
  exam_type: string | null;
  radiology_sub: string | null;
  storage_path: string;
};

/** 보고서 payload(4·5p 이미지 블록)에 박힌 storage 경로 수집 (DB 후보에 없어도 썸네일/서명 위해) */
function collectPlacedPaths(payload: unknown): string[] {
  const out = new Set<string>();
  if (typeof payload !== 'object' || !payload) return [];
  const p = payload as Record<string, unknown>;
  for (const key of ['systemsPage4Blocks', 'systemsPage5Blocks']) {
    const blocks = p[key];
    if (!Array.isArray(blocks)) continue;
    for (const b of blocks) {
      const images = (b as Record<string, unknown>)?.images;
      if (!Array.isArray(images)) continue;
      for (const slot of images) {
        const src = (slot as Record<string, unknown>)?.src;
        if (typeof src === 'string' && src && !src.startsWith('http') && !src.startsWith('blob:')) out.add(src);
      }
    }
  }
  return [...out];
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: sharePublicCorsHeadersSnapshot(request) });
}

// GET /api/content/health-checkup/review-share/case-images?token=
// 외부 검토링크 이미지 편집용: 그 run 의 케이스 이미지 후보 + 서명 미리보기 URL.
export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get('token')?.trim();
  if (!token)
    return applyPublicShareReviewCors(NextResponse.json({ error: 'token required' }, { status: 400 }), request);

  try {
    const pool = getChartPgPool();
    const hash = hashShareToken(token);
    const link = await pool.query<{ parse_run_id: string; expires_at: Date; revoked_at: Date | null }>(
      `SELECT parse_run_id, expires_at, revoked_at
       FROM health_report.health_review_share_links
       WHERE token_hash = $1 AND content_type IN ($2, $3)
       LIMIT 1`,
      [hash, LINK_CONTENT_TYPE, LEGACY_LINK_CONTENT_TYPE],
    );
    const row = link.rows[0];
    if (!row || row.revoked_at || row.expires_at.getTime() < Date.now())
      return applyPublicShareReviewCors(NextResponse.json({ error: 'Forbidden' }, { status: 403 }), request);

    const runId = row.parse_run_id;

    const imgQ = await pool.query<CaseImageRow>(
      `SELECT id, exam_type, radiology_sub, storage_path
       FROM chart_pdf.parse_run_case_images
       WHERE parse_run_id = $1::uuid
       ORDER BY idx`,
      [runId],
    );
    const dbRows = imgQ.rows ?? [];

    // 현재 배치된 경로도 서명 대상에 포함 (DB 후보에 없는 경로 대비)
    const gen = await pool.query<{ payload: unknown }>(
      `SELECT payload FROM health_report.generated_run_content WHERE parse_run_id = $1::uuid AND content_type = $2 LIMIT 1`,
      [runId, GENERATED_CONTENT_TYPE],
    );
    const placedPaths = collectPlacedPaths(gen.rows[0]?.payload);

    const allPaths = [...new Set([...dbRows.map((r) => r.storage_path), ...placedPaths])].filter(Boolean);
    const signedMap = await signCaseImageStoragePaths(allPaths);
    const signed: Record<string, string | null> = {};
    for (const p of allPaths) signed[p] = signedMap.get(p) ?? null;

    const candidates = dbRows.map((r) => ({
      id: r.id,
      storagePath: r.storage_path,
      previewUrl: signedMap.get(r.storage_path) ?? null,
      examType: r.exam_type ?? '',
      radiologySub: r.radiology_sub ?? null,
      fileName: r.storage_path.split('/').pop() ?? r.storage_path,
    }));

    return applyPublicShareReviewCors(NextResponse.json({ ok: true, runId, candidates, signed }), request);
  } catch (e) {
    console.error('GET review-share/case-images:', e);
    return applyPublicShareReviewCors(
      NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 }),
      request,
    );
  }
}
