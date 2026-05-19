import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

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

  const data: unknown = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}
