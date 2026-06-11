/**
 * 로컬 개발에서 admin-web과 hospital-web은 같은 `localhost` 도메인을 공유한다.
 * 쿠키는 포트가 아니라 도메인 단위로 격리되므로, 두 앱이 같은 Supabase 프로젝트의
 * 기본 인증 쿠키(`sb-<ref>-auth-token`)를 공유 → 한 앱에서 로그인하면 다른 앱 세션을 덮어쓴다.
 *
 * dev에서만 앱별 고유 쿠키 이름을 줘서 충돌을 막는다. (`@supabase/ssr`는 cookieOptions.name 을
 * 쿠키명이자 storageKey 로 함께 쓴다.) 프로덕션은 도메인이 달라 충돌이 없으므로 기본값을 유지해
 * 기존 세션 강제 로그아웃을 피한다.
 *
 * 주의: 한 앱 안의 모든 Supabase 클라이언트(server/client/middleware/callback)가
 * 반드시 같은 값을 써야 세션이 일관되게 읽힌다.
 */
export const SUPABASE_COOKIE_OPTIONS =
  process.env.NODE_ENV === 'development' ? { name: 'sb-hospital-auth' } : undefined;
