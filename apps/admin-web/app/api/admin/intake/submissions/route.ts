import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

export const maxDuration = 10;

// GET /api/admin/intake/submissions?hospitalId=... — 병원별 초진 접수 목록(전체 필드)
export async function GET(request: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const hospitalId = new URL(request.url).searchParams.get('hospitalId')?.trim();
  if (!hospitalId) {
    return NextResponse.json({ error: 'hospitalId가 필요합니다.' }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .schema('intake')
    .from('submissions')
    .select(
      'id, owner_name, owner_phone, owner_address, pet_count, pets, referral, consent_required, consent_marketing, answers, status, created_at',
    )
    .eq('hospital_id', hospitalId)
    .order('created_at', { ascending: false })
    .limit(300);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ submissions: data ?? [] });
}
