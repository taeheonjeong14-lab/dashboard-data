import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

const CHART_API_URL = process.env.CHART_API_URL ?? 'https://chart-api-five.vercel.app';
const CHART_API_KEY = process.env.CHART_API_KEY ?? '';

// GET /api/health-report/list
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .schema('core')
    .from('users')
    .select('hospital_id')
    .eq('id', user.id)
    .single();

  const hospitalId = profile?.hospital_id as string | null;
  if (!hospitalId) {
    return NextResponse.json({ error: '병원 정보를 불러올 수 없습니다.' }, { status: 400 });
  }

  const upstream = await fetch(
    `${CHART_API_URL}/api/history?hospitalId=${encodeURIComponent(hospitalId)}`,
    { headers: { Authorization: `Bearer ${CHART_API_KEY}` } },
  );
  const data = (await upstream.json().catch(() => ({}))) as { items?: unknown[]; error?: string };
  if (!upstream.ok) return NextResponse.json(data, { status: upstream.status });

  // 아직 추출 전/중이거나 실패한 접수(parse_run 미생성) 를 목록 맨 위에 합친다.
  let pending: unknown[] = [];
  try {
    const srvc = createServiceRoleClient();
    const { data: jobs } = await srvc
      .schema('health_report')
      .from('extract_jobs')
      .select('id, status, error_text, created_at')
      .eq('hospital_id', hospitalId)
      .eq('kind', 'hospital_notes')
      .in('status', ['queued', 'processing', 'error'])
      .order('created_at', { ascending: false });
    pending = ((jobs ?? []) as { id: string; status: string; error_text: string | null; created_at: string }[]).map((j) => ({
      id: `job:${j.id}`,
      createdAt: j.created_at,
      friendlyId: null,
      patientName: null,
      ownerName: null,
      shareUrl: null,
      expiresAt: null,
      status: j.status === 'error' ? 'error' : 'processing',
      errorText: j.error_text ?? '',
    }));
  } catch (e) {
    console.error('GET /api/health-report/list pending merge:', e);
  }

  const items = [...pending, ...(Array.isArray(data.items) ? data.items : [])];
  return NextResponse.json({ ...data, items });
}
