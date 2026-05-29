import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

export const maxDuration = 30;

const VALID_STEPS = ['blog_metrics', 'smartplace', 'keyword_rank', 'searchad'] as const;

export async function POST(request: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  let body: { jobs?: Array<{ hospitalId?: string; steps?: string[] }> } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // body 없음
  }

  const rawJobs = Array.isArray(body.jobs) ? body.jobs : [];
  if (rawJobs.length === 0) {
    return NextResponse.json({ error: '수집할 병원/항목을 선택해 주세요.' }, { status: 400 });
  }

  const validated: { hospital_id: string; steps_filter: string[] | null }[] = [];
  for (const job of rawJobs) {
    const hid = (job.hospitalId ?? '').trim();
    if (!hid || !/^[0-9a-f-]{8,36}$/i.test(hid)) {
      return NextResponse.json({ error: '유효하지 않은 hospital_id입니다.' }, { status: 400 });
    }
    const steps = Array.isArray(job.steps)
      ? job.steps.filter((s) => (VALID_STEPS as readonly string[]).includes(s))
      : VALID_STEPS.slice();
    if (steps.length === 0) {
      return NextResponse.json({ error: '수집 항목을 하나 이상 선택해 주세요.' }, { status: 400 });
    }
    validated.push({
      hospital_id: hid,
      steps_filter: steps.length < VALID_STEPS.length ? steps : null,
    });
  }

  const supabase = createServiceRoleClient();

  const { data: jobs, error: insertError } = await supabase
    .schema('analytics')
    .from('collect_jobs')
    .insert(
      validated.map(({ hospital_id, steps_filter }) => ({
        hospital_id,
        ...(steps_filter ? { steps_filter } : {}),
      })),
    )
    .select('id, hospital_id');

  if (insertError || !jobs) {
    console.error('[collect/run] insert error:', insertError);
    return NextResponse.json({ error: '수집 요청을 생성하지 못했습니다.', detail: insertError?.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    jobs: (jobs as { id: string; hospital_id: string | null }[]).map((j) => ({
      id: j.id,
      hospitalId: j.hospital_id,
    })),
  });
}
