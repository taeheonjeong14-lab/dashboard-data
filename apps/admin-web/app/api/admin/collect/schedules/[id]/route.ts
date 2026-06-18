import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

export const dynamic = 'force-dynamic';

const VALID_STEPS = ['blog_metrics', 'smartplace', 'keyword_rank', 'searchad', 'place_reviews'];

function normalize(body: Record<string, unknown>) {
  const steps = Array.isArray(body.steps)
    ? (body.steps as unknown[]).map(String).filter((s) => VALID_STEPS.includes(s))
    : [];
  const scope = body.scope === 'hospitals' ? 'hospitals' : 'all';
  const hospitalIds = scope === 'hospitals' && Array.isArray(body.hospitalIds)
    ? (body.hospitalIds as unknown[]).map(String).filter(Boolean)
    : [];
  const frequency = body.frequency === 'weekly' ? 'weekly' : 'daily';
  const hour = Math.min(23, Math.max(0, Math.trunc(Number(body.hour))));
  const weekdays = frequency === 'weekly' && Array.isArray(body.weekdays)
    ? [...new Set((body.weekdays as unknown[]).map((w) => Math.trunc(Number(w))).filter((w) => w >= 0 && w <= 6))].sort()
    : [];
  const isYmd = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  return {
    label: typeof body.label === 'string' ? body.label.trim() : '',
    enabled: body.enabled !== false,
    steps,
    scope,
    hospital_ids: hospitalIds,
    frequency,
    hour: Number.isFinite(hour) ? hour : 5,
    weekdays,
    searchad_start_date: isYmd(body.searchadStart) ? body.searchadStart : null,
    searchad_end_date: isYmd(body.searchadEnd) ? body.searchadEnd : null,
    searchad_campaign_ids: Array.isArray(body.searchadCampaignIds)
      ? (body.searchadCampaignIds as unknown[]).map(String).map((s) => s.trim()).filter(Boolean)
      : null,
    updated_at: new Date().toISOString(),
  };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;
  const { id } = await params;
  let body: Record<string, unknown> = {};
  try { body = (await request.json()) as Record<string, unknown>; } catch { /* empty */ }

  const supabase = createServiceRoleClient();
  // enabled 토글만 들어온 경우 부분 업데이트 허용
  const patch = ('enabled' in body && Object.keys(body).length === 1)
    ? { enabled: body.enabled !== false, updated_at: new Date().toISOString() }
    : normalize(body);

  const { data, error } = await supabase
    .schema('analytics')
    .from('collect_schedules')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ schedule: data });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;
  const { id } = await params;
  const supabase = createServiceRoleClient();
  const { error } = await supabase.schema('analytics').from('collect_schedules').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
