import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// GET /api/auth/check-email?email=xxx — 이메일 중복 여부 (Supabase Auth 기준)
// 서버 전용: SUPABASE_SERVICE_ROLE_KEY 필요
export async function GET(request: NextRequest) {
  try {
    const email = new URL(request.url).searchParams.get('email')?.trim();
    if (!email) {
      return NextResponse.json({ success: false, error: 'email required' }, { status: 400 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) {
      return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });
    }

    const supabase = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: { users }, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    if (error) {
      console.error('check-email listUsers error:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const normalized = email.toLowerCase();
    const exists = users?.some((u) => u.email?.toLowerCase() === normalized) ?? false;

    return NextResponse.json({ success: true, exists });
  } catch (e) {
    console.error('GET /api/auth/check-email error:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
