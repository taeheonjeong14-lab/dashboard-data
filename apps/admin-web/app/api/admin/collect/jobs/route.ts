import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

export const maxDuration = 10;

export async function GET() {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const supabase = createServiceRoleClient();
  const { data: jobs, error } = await supabase
    .schema('analytics')
    .from('collect_jobs')
    .select('id, hospital_id, status, steps, upserts, created_at, started_at, finished_at, updated_at')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ jobs: jobs ?? [] });
}
