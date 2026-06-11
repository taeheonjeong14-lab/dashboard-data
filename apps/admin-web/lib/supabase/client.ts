import { createBrowserClient } from '@supabase/ssr';
import { SUPABASE_COOKIE_OPTIONS } from '@/lib/supabase/cookie-options';

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 가 필요합니다.');
  }
  return createBrowserClient(url, anon, { cookieOptions: SUPABASE_COOKIE_OPTIONS });
}
