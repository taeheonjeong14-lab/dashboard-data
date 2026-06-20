import { cache } from 'react';
import { redirect } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

/**
 * 관리자 판별 결과 캐시. admin 자격은 거의 안 바뀌는데 매 요청(페이지·API)마다
 * ddx-api(`/api/admin/check`) + 그쪽 DB 를 타서 클릭마다 왕복 1개가 더 붙는다.
 * warm 인스턴스 메모리에 짧게 캐시해 그 왕복을 대부분 없앤다.
 * - `true`(관리자)만 캐시한다. `false`/네트워크 장애는 캐시하지 않아, 권한 부여 직후나
 *   ddx-api 일시 장애가 TTL 동안 고착되지 않게 한다(안전한 방향으로만 캐시).
 * - 서버리스 인스턴스별 메모리라 인스턴스가 식으면 자연 소멸. 관리자 수가 적어 메모리도 무시 가능.
 */
const ADMIN_CHECK_TTL_MS = 60_000;
const adminAllowedCache = new Map<string, number>(); // userId -> expiresAt(ms)

/** 서버에서만 호출. ddx-api `GET /api/admin/check` 결과로 관리자 여부 판별(짧은 메모리 캐시) */
export async function fetchDdxAdminAllowed(userId: string): Promise<boolean> {
  const cachedUntil = adminAllowedCache.get(userId);
  if (cachedUntil && cachedUntil > Date.now()) return true;

  const base = process.env.DDX_API_BASE_URL?.trim();
  if (!base) return false;
  const url = `${base.replace(/\/$/, '')}/api/admin/check?userId=${encodeURIComponent(userId)}`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean; allowed?: boolean };
    const allowed = Boolean(data.success && data.allowed);
    if (allowed) {
      adminAllowedCache.set(userId, Date.now() + ADMIN_CHECK_TTL_MS);
    } else {
      adminAllowedCache.delete(userId);
    }
    return allowed;
  } catch {
    return false;
  }
}

/** 세션 필수 + ddx-api 기준 관리자만 통과. 아니면 `/login` 또는 `forbidden`으로 리다이렉트.
 *  cache(): 한 요청(렌더)에서 레이아웃·페이지가 여러 번 호출해도 getUser+권한확인 왕복은 1회만. */
export const requireAdminSession = cache(async (): Promise<User> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const allowed = await fetchDdxAdminAllowed(user.id);
  if (!allowed) redirect('/login?error=forbidden');
  return user;
});
