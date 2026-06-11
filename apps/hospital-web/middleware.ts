import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { SUPABASE_COOKIE_OPTIONS } from '@/lib/supabase/cookie-options';

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: SUPABASE_COOKIE_OPTIONS,
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  const isAuthPage =
    pathname.startsWith('/login') || pathname.startsWith('/signup');
  const isPublic =
    isAuthPage ||
    pathname.startsWith('/auth') ||
    pathname.startsWith('/verify-email') ||
    // 비밀번호 재설정(복구 토큰은 URL 해시라 서버가 못 보므로 반드시 공개로 둔다)
    pathname.startsWith('/reset-password') ||
    // 보호자용 초진 접수증(공개 폼) + 제출 API — 로그인 없이 접근
    pathname.startsWith('/intake') ||
    pathname.startsWith('/api/intake') ||
    // 보호자용 사전문진 작성(공개 폼) + 공개 ddx 프록시 — 로그인 없이 접근
    pathname.startsWith('/survey') ||
    pathname.startsWith('/api/ddx-public');

  if (!user && !isPublic) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  if (user && isAuthPage) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
