import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { SUPABASE_COOKIE_OPTIONS } from '@/lib/supabase/cookie-options';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  if (!code) {
    return NextResponse.redirect(`${origin}/login?message=missing_code`);
  }

  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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
    },
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/login?message=exchange_failed`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    // Upsert into core.users — approved=false until admin approves
    await supabase
      .schema('core')
      .from('users')
      .upsert(
        {
          id: user.id,
          email: user.email,
          name: user.user_metadata?.name ?? null,
          phone: user.user_metadata?.phone ?? null,
          hospital_name: user.user_metadata?.hospital_name ?? null,
          approved: false,
        },
        { onConflict: 'id', ignoreDuplicates: true },
      );

    return NextResponse.redirect(`${origin}/verify-email`);
  }

  return NextResponse.redirect(`${origin}/login`);
}
