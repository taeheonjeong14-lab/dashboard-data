import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';

/**
 * 로그인 사용자(Auth) 조회 — 한 요청(렌더) 내에서 1회만 왕복.
 * 레이아웃·페이지·서버 헬퍼가 각각 supabase.auth.getUser() 를 부르면 Auth 서버 왕복이 매번 생기는데,
 * React cache() 로 감싸 같은 렌더에서 공유한다.
 */
export const getCachedUser = cache(async () => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
});
