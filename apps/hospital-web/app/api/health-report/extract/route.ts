import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

const CHART_API_URL = process.env.CHART_API_URL ?? 'https://chart-api-five.vercel.app';
const CHART_API_KEY = process.env.CHART_API_KEY ?? '';

// 건강검진 리포트 1건 = 50토큰
const REPORT_TOKEN_COST = 50;

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

  // 토큰 사전 점검 — 잔액 부족이면 차단(음수 불가).
  // 토큰 컬럼이 아직 없으면(마이그레이션 전) tokensReady=false → 차감 로직 건너뜀(기존 동작 유지).
  let tokensReady = false;
  {
    const { data: tb, error: tbErr } = await supabase
      .schema('core')
      .from('users')
      .select('token_balance')
      .eq('id', user.id)
      .single();
    const balance = (tb as { token_balance?: number } | null)?.token_balance;
    if (!tbErr && typeof balance === 'number') {
      tokensReady = true;
      if (balance < REPORT_TOKEN_COST) {
        return NextResponse.json(
          { error: `토큰이 부족합니다. (보유 ${balance.toLocaleString()}, 필요 ${REPORT_TOKEN_COST})` },
          { status: 402 },
        );
      }
    }
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

  // 추출 성공 시에만 50토큰 차감(원자적, 음수 불가). 실패는 무료.
  if (tokensReady) {
    try {
      const srvc = createServiceRoleClient();
      await srvc.schema('core').rpc('token_deduct', {
        p_user_id: user.id,
        p_amount: REPORT_TOKEN_COST,
        p_reason: 'health_report',
        p_hospital_id: hospitalId,
      });
    } catch (e) {
      // 사전 점검을 통과했으므로 통상 도달하지 않음. best-effort.
      console.error('token_deduct failed:', e);
    }
  }

  // On success, the chart-api returns { runId, friendlyId, documentId, ... }
  // We surface runId and friendlyId to the client.
  return NextResponse.json(data, { status: 200 });
}
