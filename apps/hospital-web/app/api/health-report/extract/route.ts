import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

const CHART_API_URL = process.env.CHART_API_URL ?? 'https://chart-api-five.vercel.app';
const CHART_API_KEY = process.env.CHART_API_KEY ?? '';

// 건강검진 리포트 1건 = 50토큰
const REPORT_TOKEN_COST = 50;

// chart-api 추출(OCR+LLM+버켓팅)을 기다리는 프록시. 다중 PDF 머지 등으로 길어질 수 있어 800초(Pro 상한).
export const maxDuration = 800;

type ExtractBody = {
  storagePath?: string;
  storagePaths?: string[]; // 다중 PDF(같은 진료분 차트본문+검사결과 등). 있으면 storagePath보다 우선.
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
  const storagePaths = Array.isArray(body.storagePaths)
    ? body.storagePaths.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    : [];

  if ((!storagePath && storagePaths.length === 0) || !chartType || !hospitalId) {
    return NextResponse.json(
      { error: 'storagePath(또는 storagePaths), chartType, hospitalId는 필수입니다.' },
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
  if (storagePaths.length > 0) {
    params.set('storagePaths', JSON.stringify(storagePaths));
  } else if (storagePath) {
    params.set('storagePath', storagePath);
  }
  params.set('storageBucket', storageBucket ?? '');
  params.set('chartType', chartType);
  params.set('hospitalId', hospitalId);
  if (body.emphasisText) params.set('emphasisText', body.emphasisText);

  let upstream: Response;
  try {
    upstream = await fetch(`${CHART_API_URL}/api/text-bucketing`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Bearer ${CHART_API_KEY}`,
      },
      body: params.toString(),
    });
  } catch (e) {
    // 네트워크 오류·게이트웨이 타임아웃 등 — chart-api 응답 자체를 못 받음
    return NextResponse.json(
      { error: `차트 분석 서버에 연결하지 못했습니다: ${e instanceof Error ? e.message : 'unknown'}` },
      { status: 502 },
    );
  }

  // chart-api 가 비-JSON(함수 크래시/빈 응답)을 줄 수 있으므로 text로 받고 안전 파싱한다.
  const rawText = await upstream.text().catch(() => '');
  let data: unknown = null;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    data = null;
  }

  if (!upstream.ok) {
    const surfaced =
      (data as { error?: string } | null)?.error ??
      (upstream.status === 504 || upstream.status === 408
        ? '차트 분석 시간이 초과되었습니다. 페이지가 많으면 해당 진료분만 잘라서 올려주세요.'
        : `차트 분석 서버 오류 (${upstream.status})${rawText ? `: ${rawText.slice(0, 200)}` : ' — 응답 본문 없음'}`);
    return NextResponse.json({ error: surfaced }, { status: upstream.status });
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
