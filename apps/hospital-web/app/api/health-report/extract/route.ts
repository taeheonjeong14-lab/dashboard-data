import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const CHART_API_URL = process.env.CHART_API_URL ?? 'https://chart-api-five.vercel.app';
const CHART_API_KEY = process.env.CHART_API_KEY ?? '';

export const maxDuration = 120;

type ExtractBody = {
  storagePath?: string;
  storageBucket?: string;
  chartType?: string;
  hospitalId?: string;
  emphasisText?: string;
};

// POST /api/health-report/extract
// Proxy to chart-api /api/text-bucketing after verifying session.
export async function POST(request: NextRequest) {
  // Auth check
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  let body: ExtractBody;
  try {
    body = (await request.json()) as ExtractBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { storagePath, storageBucket, chartType, hospitalId } = body;

  if (!storagePath || !chartType || !hospitalId) {
    return NextResponse.json(
      { error: 'storagePath, chartType, hospitalId는 필수입니다.' },
      { status: 400 },
    );
  }

  const params = new URLSearchParams();
  params.set('storagePath', storagePath);
  params.set('storageBucket', storageBucket ?? '');
  params.set('chartType', chartType);
  params.set('hospitalId', hospitalId);
  if (body.emphasisText) params.set('emphasisText', body.emphasisText);

  const upstream = await fetch(`${CHART_API_URL}/api/text-bucketing`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Bearer ${CHART_API_KEY}`,
    },
    body: params.toString(),
  });

  const data: unknown = await upstream.json();

  if (!upstream.ok) {
    return NextResponse.json(data, { status: upstream.status });
  }

  // On success, the chart-api returns { runId, friendlyId, documentId, ... }
  // We surface runId and friendlyId to the client.
  return NextResponse.json(data, { status: 200 });
}
