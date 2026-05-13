import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

export const maxDuration = 30;

export async function POST(request: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  let body: { hospitalId?: string } = {};
  try {
    body = (await request.json()) as { hospitalId?: string };
  } catch {
    // body 없음 = 전체 병원 배치
  }

  const hospitalId = (body.hospitalId ?? '').trim() || null;
  if (hospitalId && !/^[0-9a-f-]{8,36}$/i.test(hospitalId)) {
    return NextResponse.json({ error: '유효하지 않은 hospital_id입니다.' }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { data: job, error } = await supabase
    .schema('core')
    .from('collect_jobs')
    .insert({ hospital_id: hospitalId })
    .select('id')
    .single();

  if (error || !job) {
    return NextResponse.json({ error: '수집 요청을 생성하지 못했습니다.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, jobId: (job as { id: string }).id });
}
