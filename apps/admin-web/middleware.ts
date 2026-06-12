import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { SUPABASE_COOKIE_OPTIONS } from '@/lib/supabase/cookie-options';

export async function middleware(request: NextRequest) {
  const supabaseResponse = NextResponse.next();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return supabaseResponse;
  }

  const supabase = createServerClient(url, anon, {
    cookieOptions: SUPABASE_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  await supabase.auth.getUser();

  return supabaseResponse;
}

export const config = {
  // `/api` 제외: 이 미들웨어는 리다이렉트 없이 세션 갱신용 getUser() 만 한다.
  // 모든 admin API 는 requireAdminApi() 에서 자체적으로 getUser() 하므로, API 호출마다
  // 미들웨어 getUser() 가 또 도는 건 Auth 서버 왕복 1개를 매번 중복으로 더하는 셈이다.
  // 페이지 네비게이션은 그대로 미들웨어가 세션을 갱신한다.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
