import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { isParseRunUuid } from '@/lib/chart-extraction/uuid';
import { getChartApiProxyConfig } from '@/lib/chart-api-proxy-env';
import { formatChartApiFetchError } from '@/lib/chart-api-fetch-error';
import { notifyHospitalUsers, notifyAdminError, runHospitalAndPatient } from '@/lib/notify';
import { ensureRunImagesLabeled } from '@/lib/chart-case-images/ensure-labeled';
import { logError } from '@dashboard/error-log';

export const dynamic = 'force-dynamic';
// 라벨링을 여기서 먼저 돌리므로(미분류가 있을 때만) 프록시보다 시간이 더 걸릴 수 있다.
export const maxDuration = 300;

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

  const genLabel = String(o.contentType ?? '') === 'health_checkup' ? '건강검진 리포트 생성' : '콘텐츠 생성';

  // 라벨이 필요한 건 건강검진 리포트뿐이다(배치·정렬·캡션·a/b 분리·c/d 필터). 업로드 시점에는
  // 저장만 하고, 실제로 쓰기 직전인 여기서 미분류분만 1회 분류한다. 전부 분류돼 있으면 LLM 호출 0.
  // 실패해도 생성은 계속한다 — 라벨 없이 배치될 뿐이고, 그 편이 생성을 통째로 막는 것보다 낫다.
  //
  // ★ 1단계인 **검진 포인트(health_points)에서도** 돌린다. 포인트는 "리포트에서 무엇을 말할지"를
  //   정하는 단계라, 여기서 이미지 판독이 비어 있으면 이미지 소견은 리포트 어디에도 실리지 않는다
  //   (실측: 이미지 30장이 미분류라 근거가 0개가 되어 포인트 생성이 실패했다).
  //   멱등이라 2단계에서 다시 불러도 LLM 호출은 0이다.
  if (['health_checkup', 'health_points'].includes(String(o.contentType ?? ''))) {
    try {
      const r = await ensureRunImagesLabeled(runId, 'health_report');
      if (r.groups > 0) {
        console.info(`[health-report/generate] 라벨링 ${r.labeled}장 / ${r.groups}회 · run ${runId}`);
      }
    } catch (e) {
      console.error('[health-report/generate] 이미지 라벨링 실패(생성은 계속):', e);
      await logError({
        app: 'admin-web',
        source: 'server',
        route: '/api/admin/health-report/generate',
        feature: 'image_analysis',
        message: `리포트 생성 전 이미지 라벨링 실패: ${e instanceof Error ? e.message : String(e)}`,
        stack: e instanceof Error ? e.stack ?? null : null,
        context: { runId },
      });
    }
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
      await notifyAdminError({ source: genLabel, message: `chart-api 응답이 JSON이 아닙니다 (${res.status}) · run ${runId}`, link: '/admin/health-report' });
      return NextResponse.json(
        { error: `chart-api 응답이 JSON이 아닙니다 (${res.status})`, raw: text.slice(0, 500) },
        { status: 502 },
      );
    }
    // chart-api 가 오류 상태로 응답 — 생성 실패
    if (!res.ok) {
      const detail = (json as { error?: string } | null)?.error;
      await notifyAdminError({ source: genLabel, message: `${detail ? `${detail} · ` : ''}(${res.status}) run ${runId}`, link: '/admin/health-report' });
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
    await notifyAdminError({ source: genLabel, message: `${formatChartApiFetchError(e)} · run ${runId}`, link: '/admin/health-report' });
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