import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

export const maxDuration = 10;

// 진행 중(running)/대기(pending) 잡을 수동으로 종료(failed) 처리한다.
// 워커가 죽어 reaper가 못 도는 '중단 추정' 잡을 admin에서 바로 정리하기 위함.
export async function POST(request: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  let body: { jobId?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // body 없음
  }

  const jobId = (body.jobId ?? '').trim();
  if (!jobId || !/^[0-9a-f-]{8,36}$/i.test(jobId)) {
    return NextResponse.json({ error: '유효하지 않은 jobId입니다.' }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const now = new Date().toISOString();
  const { error } = await supabase
    .schema('analytics')
    .from('collect_jobs')
    .update({
      status: 'failed',
      finished_at: now,
      updated_at: now,
      output: '[수동 종료] admin에서 수집을 종료함',
    })
    .eq('id', jobId)
    .in('status', ['running', 'pending']); // 이미 끝난(done/failed) 잡은 건드리지 않음

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
