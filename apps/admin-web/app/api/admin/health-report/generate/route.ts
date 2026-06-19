import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { isParseRunUuid } from '@/lib/chart-extraction/uuid';
import { getChartApiProxyConfig } from '@/lib/chart-api-proxy-env';
import { formatChartApiFetchError } from '@/lib/chart-api-fetch-error';
import { notifyHospitalUsers, runHospitalAndPatient } from '@/lib/notify';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * LLM 건강검진 컨텐츠 생성 — chart-api `POST /api/content/generate` 로 서버 프록시.
 * 로컬 `.env`에 `CHART_API_BASE_URL`, `CHART_APP_API_KEY` 가 있어야 합니다.
 */
export async function POST(request: NextRequest) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const cfg = getChartApiProxyConfig();
  if (!cfg) {
    return NextResponse.json(
      {
        error:
          'Chart API 프록시가 설정되지 않았습니다. CHART_API_BASE_URL 과 CHART_APP_API_KEY 를 채우면 생성 요청을 chart-api로 전달합니다.',
      },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const o = body as Record<string, unknown>;
  const runId = String(o.runId ?? '').trim();
  if (!isParseRunUuid(runId)) {
    return NextResponse.json({ error: 'runId invalid' }, { status: 400 });
  }

  const url = `${cfg.outboundBase}/api/content/generate`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.key}`,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      return NextResponse.json(
        { error: `chart-api 응답이 JSON이 아닙니다 (${res.status})`, raw: text.slice(0, 500) },
        { status: 502 },
      );
    }
    // 건강검진 리포트 생성 완료 시 병원 유저 알림
    if (res.ok && String(o.contentType ?? '') === 'health_checkup') {
      const { hospitalId, patientName } = await runHospitalAndPatient(runId);
      await notifyHospitalUsers(hospitalId, {
        type: 'health_report_ready',
        title: '건강검진 리포트 준비 완료',
        body: `${patientName || '환자'} 건강검진 리포트가 준비되었습니다. 검토 후 보호자님께 발송해주세요!`,
        link: '/health-report',
      });
    }

    return NextResponse.json(json, { status: res.status });
  } catch (e) {
    console.error('POST /api/admin/health-report/generate (proxy):', e);
    return NextResponse.json(
      {
        error: formatChartApiFetchError(e),
        chartApiBase: cfg.base,
        chartApiFetchBase: cfg.outboundBase,
      },
      { status: 502 },
    );
  }
}