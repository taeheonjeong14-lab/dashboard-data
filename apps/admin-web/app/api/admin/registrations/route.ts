import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

export const dynamic = 'force-dynamic';

// GET /api/admin/registrations?status=pending — 병원 등록 신청 목록
export async function GET(request: NextRequest) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;
  const status = request.nextUrl.searchParams.get('status') ?? 'pending';
  const supabase = createServiceRoleClient();
  let q = supabase.schema('core').from('hospital_registrations').select('*').order('created_at', { ascending: false });
  if (status !== 'all') q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ registrations: data ?? [] });
}
