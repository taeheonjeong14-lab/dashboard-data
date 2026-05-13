import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

export const maxDuration = 10;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const { jobId } = await params;
  const supabase = createServiceRoleClient();
  const { data: job, error } = await supabase
    .schema('core')
    .from('collect_jobs')
    .select('id, status, output, steps, upserts, created_at, started_at, finished_at')
    .eq('id', jobId)
    .single();

  if (error || !job) {
    return NextResponse.json({ error: 'Job을 찾을 수 없습니다.' }, { status: 404 });
  }

  return NextResponse.json(job);
}
