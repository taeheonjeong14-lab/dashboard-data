'use client';

/**
 * 세션 만료 감시 — 뒷단에서 로그아웃됐는데 화면은 그대로 남아 있던 문제를 막는다.
 *
 * 증상: 오래 켜두면 리프레시 토큰이 만료돼 서버 기준으론 비로그인 상태가 되는데,
 * SPA 는 페이지 이동이 없어 미들웨어를 안 거치니 화면이 그대로였다. 그 상태로 뭔가를 누르면
 * API 요청만 401(예전엔 /login 리다이렉트 → 405)로 실패해서, 사용자는 이유를 알 수 없었다.
 *
 * 대응: (1) Supabase 인증 이벤트로 로그아웃/토큰 갱신 실패를 잡고,
 *       (2) 탭이 다시 활성화될 때 세션을 확인한다(장시간 방치 후 복귀 시점).
 * 만료면 로그인 화면으로 보낸다(돌아올 곳을 next 로 붙인다).
 */
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export function goToLogin(): void {
  if (typeof window === 'undefined') return;
  const next = window.location.pathname + window.location.search;
  const url = next && next !== '/login' ? `/login?next=${encodeURIComponent(next)}` : '/login';
  window.location.href = url;
}

export function SessionWatcher() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const supabase = createClient();

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      // SIGNED_OUT: 명시적 로그아웃 또는 리프레시 실패. 세션이 사라진 경우도 함께 본다.
      if (event === 'SIGNED_OUT' || (event === 'TOKEN_REFRESHED' && !session)) {
        goToLogin();
      }
    });

    // 탭 복귀 시 실제 세션이 살아 있는지 확인(방치 중 만료된 경우를 여기서 잡는다).
    const onFocus = () => {
      if (document.visibilityState !== 'visible') return;
      void supabase.auth.getSession().then(({ data }) => {
        if (!data.session) goToLogin();
      });
    };
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);

    return () => {
      sub.subscription.unsubscribe();
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
    };
  }, [router, pathname]);

  return null;
}
