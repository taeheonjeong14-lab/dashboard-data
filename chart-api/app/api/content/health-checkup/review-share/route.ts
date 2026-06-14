import { NextRequest, NextResponse } from 'next/server';
import { chartAppAuthMiddleware } from '@/lib/chart-app/auth';
import { upsertGeneratedRunContent } from '@/lib/chart-app/generated-content';
import { hashShareToken } from '@/lib/chart-app/share-token';
import { ensureHealthCheckupReviewShareLink } from '@/lib/chart-app/review-share-link';
import { isParseRunUuid } from '@/lib/chart-app/uuid';
import { getChartPgPool } from '@/lib/db';
import {
  applyPublicShareReviewCors,
  sharePublicCorsHeadersSnapshot,
} from '@/lib/chart-app/share-public-cors';
import { signCaseImageStoragePaths } from '@/lib/chart-app/image-case-signing';

async function signPayloadImageSlots(payload: unknown): Promise<unknown> {
  if (typeof payload !== 'object' || !payload) return payload;
  const p = payload as Record<string, unknown>;
  const blockKeys = ['systemsPage4Blocks', 'systemsPage5Blocks'];
  const paths: string[] = [];
  for (const key of blockKeys) {
    const blocks = p[key];
    if (!Array.isArray(blocks)) continue;
    for (const b of blocks) {
      if (typeof b !== 'object' || !b) continue;
      const images = (b as Record<string, unknown>).images;
      if (!Array.isArray(images)) continue;
      for (const slot of images) {
        const src = (slot as Record<string, unknown>)?.src;
        if (typeof src === 'string' && src && !src.startsWith('http')) paths.push(src);
      }
    }
  }
  if (paths.length === 0) return payload;
  const signed = await signCaseImageStoragePaths(paths);
  if (signed.size === 0) return payload;
  const cloned = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
  for (const key of blockKeys) {
    const blocks = cloned[key];
    if (!Array.isArray(blocks)) continue;
    for (const b of blocks) {
      if (typeof b !== 'object' || !b) continue;
      const images = (b as Record<string, unknown>).images;
      if (!Array.isArray(images)) continue;
      for (const slot of images) {
        if (typeof slot !== 'object' || !slot) continue;
        const s = slot as Record<string, unknown>;
        if (typeof s.src === 'string' && s.src) { const url = signed.get(s.src); if (url) s.src = url; }
      }
    }
  }
  return cloned;
}

// DB 호환: vet-report는 아직 health_checkup(underscore)을 기대한다.
const LINK_CONTENT_TYPE = 'health_checkup';
const LEGACY_LINK_CONTENT_TYPE = 'health-checkup';
const RESPONSE_CONTENT_TYPE = 'health-checkup';
const GENERATED_CONTENT_TYPE = 'health_checkup';


export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: sharePublicCorsHeadersSnapshot(request) });
}

// POST /api/content/health-checkup/review-share
export async function POST(request: NextRequest) {
  const authErr = chartAppAuthMiddleware(request);
  if (authErr) return applyPublicShareReviewCors(authErr, request);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return applyPublicShareReviewCors(NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }), request);
  }

  const runId = String(body.runId ?? '').trim();
  if (!isParseRunUuid(runId))
    return applyPublicShareReviewCors(NextResponse.json({ error: 'runId invalid' }, { status: 400 }), request);

  try {
    const pool = getChartPgPool();
    const ok = await pool.query(`SELECT 1 FROM chart_pdf.parse_runs WHERE id = $1::uuid`, [runId]);
    if (ok.rows.length === 0)
      return applyPublicShareReviewCors(NextResponse.json({ error: 'run not found' }, { status: 404 }), request);

    // (parse_run_id, content_type) 당 1행 upsert — 이미 있으면 만료만 7일 연장하고 기존 링크 유지.
    const { shareUrl, expiresAt } = await ensureHealthCheckupReviewShareLink(
      pool,
      runId,
      new URL(request.url).origin,
    );
    console.info('[review-share:issue] ok', {
      runId,
      expiresAt,
      contentTypeDb: LINK_CONTENT_TYPE,
    });

    return applyPublicShareReviewCors(
      NextResponse.json({
        ok: true,
        contentType: RESPONSE_CONTENT_TYPE,
        shareUrl,
        expiresAt,
      }),
      request,
    );
  } catch (e) {
    console.error('POST review-share:', e);
    return applyPublicShareReviewCors(
      NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 }),
      request,
    );
  }
}

// GET /api/content/health-checkup/review-share?token=
export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get('token')?.trim();
  if (!token)
    return applyPublicShareReviewCors(NextResponse.json({ error: 'token required' }, { status: 400 }), request);

  try {
    const pool = getChartPgPool();
    const hash = hashShareToken(token);
    const hashPrefix = hash.slice(0, 10);
    const link = await pool.query<{
      parse_run_id: string;
      expires_at: Date;
      revoked_at: Date | null;
    }>(
      `
      SELECT parse_run_id, expires_at, revoked_at
      FROM health_report.health_review_share_links
      WHERE token_hash = $1 AND content_type IN ($2, $3)
      LIMIT 1
      `,
      [hash, LINK_CONTENT_TYPE, LEGACY_LINK_CONTENT_TYPE],
    );
    const row = link.rows[0];
    if (!row) {
      console.warn('[review-share:get] forbidden:not_found', { hashPrefix });
      return applyPublicShareReviewCors(NextResponse.json({ error: 'Forbidden' }, { status: 403 }), request);
    }
    if (row.revoked_at) {
      console.warn('[review-share:get] forbidden:revoked', { hashPrefix, runId: row.parse_run_id });
      return applyPublicShareReviewCors(NextResponse.json({ error: 'Forbidden' }, { status: 403 }), request);
    }
    if (row.expires_at.getTime() < Date.now()) {
      console.warn('[review-share:get] forbidden:expired', {
        hashPrefix,
        runId: row.parse_run_id,
        expiresAt: row.expires_at.toISOString(),
      });
      return applyPublicShareReviewCors(NextResponse.json({ error: 'Forbidden' }, { status: 403 }), request);
    }

    await pool.query(
      `UPDATE health_report.health_review_share_links SET last_accessed_at = now(), updated_at = now() WHERE token_hash = $1 AND content_type IN ($2, $3)`,
      [hash, LINK_CONTENT_TYPE, LEGACY_LINK_CONTENT_TYPE],
    );

    const gen = await pool.query<{ id: string; payload: unknown; created_at: Date; updated_at: Date }>(
      `
      SELECT id, payload, created_at, updated_at
      FROM health_report.generated_run_content
      WHERE parse_run_id = $1::uuid AND content_type = $2
      LIMIT 1
      `,
      [row.parse_run_id, GENERATED_CONTENT_TYPE],
    );
    const g = gen.rows[0];
    if (!g) {
      console.warn('[review-share:get] not_found:generated', { hashPrefix, runId: row.parse_run_id });
      return applyPublicShareReviewCors(
        NextResponse.json({ error: 'generated content not found' }, { status: 404 }),
        request,
      );
    }

    const signedPayload = await signPayloadImageSlots(g.payload);
    return applyPublicShareReviewCors(
      NextResponse.json({
        ok: true,
        runId: row.parse_run_id,
        expiresAt: row.expires_at.toISOString(),
        generated: signedPayload,
        saved: {
          id: g.id,
          createdAt: g.created_at.toISOString(),
          updatedAt: g.updated_at.toISOString(),
        },
      }),
      request,
    );
  } catch (e) {
    console.error('GET review-share:', e);
    return applyPublicShareReviewCors(
      NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 }),
      request,
    );
  }
}

// PATCH /api/content/health-checkup/review-share — 외부 검토 반영
export async function PATCH(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return applyPublicShareReviewCors(NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }), request);
  }

  const token = String(body.token ?? '').trim();
  const payload = body.payload;
  if (!token)
    return applyPublicShareReviewCors(NextResponse.json({ error: 'token required' }, { status: 400 }), request);

  try {
    const pool = getChartPgPool();
    const hash = hashShareToken(token);
    const hashPrefix = hash.slice(0, 10);
    const link = await pool.query<{ parse_run_id: string; expires_at: Date; revoked_at: Date | null }>(
      `SELECT parse_run_id, expires_at, revoked_at FROM health_report.health_review_share_links WHERE token_hash = $1 AND content_type IN ($2, $3) LIMIT 1`,
      [hash, LINK_CONTENT_TYPE, LEGACY_LINK_CONTENT_TYPE],
    );
    const row = link.rows[0];
    if (!row) {
      console.warn('[review-share:patch] forbidden:not_found', { hashPrefix });
      return applyPublicShareReviewCors(NextResponse.json({ error: 'Forbidden' }, { status: 403 }), request);
    }
    if (row.revoked_at) {
      console.warn('[review-share:patch] forbidden:revoked', { hashPrefix, runId: row.parse_run_id });
      return applyPublicShareReviewCors(NextResponse.json({ error: 'Forbidden' }, { status: 403 }), request);
    }
    if (row.expires_at.getTime() < Date.now()) {
      console.warn('[review-share:patch] forbidden:expired', {
        hashPrefix,
        runId: row.parse_run_id,
        expiresAt: row.expires_at.toISOString(),
      });
      return applyPublicShareReviewCors(NextResponse.json({ error: 'Forbidden' }, { status: 403 }), request);
    }

    await pool.query(
      `UPDATE health_report.health_review_share_links SET last_accessed_at = now(), updated_at = now() WHERE token_hash = $1 AND content_type IN ($2, $3)`,
      [hash, LINK_CONTENT_TYPE, LEGACY_LINK_CONTENT_TYPE],
    );

    const saved = await upsertGeneratedRunContent(pool, row.parse_run_id, GENERATED_CONTENT_TYPE, payload);
    return applyPublicShareReviewCors(
      NextResponse.json({ ok: true, runId: row.parse_run_id, saved }),
      request,
    );
  } catch (e) {
    console.error('PATCH review-share:', e);
    return applyPublicShareReviewCors(
      NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 }),
      request,
    );
  }
}
