import { NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase-server'
import { cookies } from 'next/headers'

export async function GET() {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'dev only' }, { status: 403 })
  }

  try {
    const cookieStore = await cookies()
    const allCookies = cookieStore.getAll()
    const supabaseCookies = allCookies.filter((c) =>
      c.name.includes('supabase') || c.name.startsWith('sb-')
    )

    const supabase = await getSupabaseServerClient()
    const { data: { user }, error } = await supabase.auth.getUser()

    return NextResponse.json({
      ok: true,
      hasSupabaseCookies: supabaseCookies.length > 0,
      supabaseCookieCount: supabaseCookies.length,
      cookieNames: supabaseCookies.map((c) => c.name),
      userId: user?.id ?? null,
      userEmail: user?.email ?? null,
      authError: error?.message ?? null,
    })
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 500 }
    )
  }
}
