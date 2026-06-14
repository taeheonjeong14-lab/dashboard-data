import type pg from 'pg';
import { hashShareToken, randomShareToken } from '@/lib/chart-app/share-token';

// vet-report 호환: DB 저장 content_type 은 health_checkup(underscore).
const LINK_CONTENT_TYPE = 'health_checkup';

export type EnsuredShareLink = { shareUrl: string; expiresAt: string };

/**
 * 건강검진 외부 검토 링크를 보장(upsert)한다.
 * - (parse_run_id, content_type) 당 1행. 없으면 새로 발급, 있으면 만료를 7일 연장하고 revoke 해제.
 * - 이미 존재하면 기존 share_url(=기존 토큰) 을 그대로 유지한다 → 이미 공유된 링크가 깨지지 않는다.
 * - 7일 만료 정책은 유지(과금 연동).
 *
 * @param origin 링크 base origin (보통 `new URL(request.url).origin` — chart-api 오리진)
 */
export async function ensureHealthCheckupReviewShareLink(
  client: pg.Pool | pg.PoolClient,
  runId: string,
  origin: string,
): Promise<EnsuredShareLink> {
  // 신규 발급 시에만 쓰일 후보 토큰/URL. 충돌(이미 존재) 시엔 기존 행 값이 유지된다.
  const token = randomShareToken();
  const tokenHash = hashShareToken(token);
  const candidateUrl = `${origin}/review/health-checkup/${encodeURIComponent(token)}`;

  const { rows } = await client.query<{ share_url: string; expires_at: Date }>(
    `
    INSERT INTO health_report.health_review_share_links
      (parse_run_id, content_type, token_hash, expires_at, share_url)
    VALUES ($1::uuid, $2, $3, now() + interval '7 days', $4)
    ON CONFLICT (parse_run_id, content_type) DO UPDATE SET
      expires_at = now() + interval '7 days',
      revoked_at = NULL,
      updated_at = now()
    RETURNING share_url, expires_at
    `,
    [runId, LINK_CONTENT_TYPE, tokenHash, candidateUrl],
  );

  const row = rows[0];
  return { shareUrl: row.share_url, expiresAt: row.expires_at.toISOString() };
}
