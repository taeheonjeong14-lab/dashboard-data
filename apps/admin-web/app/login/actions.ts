'use server';

import { redirect } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { SUPABASE_COOKIE_OPTIONS } from '@/lib/supabase/cookie-options';

export type SignInResult = { ok: true } | { ok: false; error: string };

export async function signInWithPasswordAction(email: string, password: string): Promise<SignInResult> {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed || !password) {
    return { ok: false, error: '이메일과 비밀번호를 입력하세요.' };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anon) {
    return { ok: false, error: '서버에 NEXT_PUBLIC_SUPABASE_URL / ANON_KEY 가 없습니다.' };
  }

  const cookieStore = await cookies();

  const supabase = createServerClient(url, anon, {
    cookieOptions: SUPABASE_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          cookieStore.set(name, value, options),
        );
      },
    },
  });

  const { error } = await supabase.auth.signInWithPassword({
    email: trimmed,
    password,
  });

  if (error) {
    return { ok: false, error: error.message };
  }
  redirect('/admin');
}
