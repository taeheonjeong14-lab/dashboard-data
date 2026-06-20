// 비동기 추출 워커 (extract_jobs). 변경 시 hospital-web 재배포 트리거됨.
import { setGlobalDispatcher, Agent } from 'undici';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { notifyAdminError } from '@/lib/notify';

// chart-api 추출은 오래 걸리므로 fetch 타임아웃을 800초로(undici 기본 300초 우회).
setGlobalDispatcher(new Agent({ headersTimeout: 800_000, bodyTimeout: 800_000, connectTimeout: 20_000 }));

const CHART_API_URL = process.env.CHART_API_URL ?? 'https://chart-api-five.vercel.app';
const CHART_API_KEY = process.env.CHART_API_KEY ?? '';
const MAX_ATTEMPTS = 3;

export type ExtractJob = {
  id: string;
  hospital_id: string;
  user_id: string;
  chart_type: string;
  kind: 'blog_case' | 'hospital_notes';
  storage_bucket: string;
  storage_paths: string[];
  payload: Record<string, unknown>;
  status: string;
  run_id: string | null;
  token_cost: number;
  token_deducted: boolean;
  attempts: number;
};

type Srvc = ReturnType<typeof createServiceRoleClient>;

async function callChartApiExtract(job: ExtractJob): Promise<string> {
  const params = new URLSearchParams();
  params.set('storagePaths', JSON.stringify(job.storage_paths));
  params.set('storageBucket', job.storage_bucket);
  params.set('chartType', job.chart_type);
  params.set('hospitalId', job.hospital_id);
  // 추출 차감을 상품에 귀속시키기 위해 job.kind 를 상품 코드로 넘긴다.
  params.set('product', job.kind === 'blog_case' ? 'case_blog' : 'health_report');
  const emphasis = (job.payload as { emphasis_text?: string }).emphasis_text;
  if (typeof emphasis === 'string' && emphasis) params.set('emphasisText', emphasis);

  const res = await fetch(`${CHART_API_URL}/api/text-bucketing`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Bearer ${CHART_API_KEY}`,
    },
    body: params.toString(),
  });
  const raw = await res.text().catch(() => '');
  let data: { runId?: string; error?: string } = {};
  try {
    data = raw ? (JSON.parse(raw) as typeof data) : {};
  } catch {
    /* 타임아웃/크래시 시 비-JSON */
  }
  if (!res.ok || !data.runId) {
    const timedOut =
      res.status === 504 ||
      res.status === 408 ||
      /FUNCTION_INVOCATION_TIMEOUT|timeout|timed out/i.test(raw);
    throw new Error(
      timedOut
        ? '파일 용량 초과 - PDF파일이 너무 용량이 크거나 이미지 파일이 너무 많습니다.'
        : data.error ?? `차트 분석 실패 (${res.status})`,
    );
  }
  return data.runId;
}

async function saveContent(srvc: Srvc, job: ExtractJob, runId: string): Promise<void> {
  // job.payload 는 submit 단계에서 generated_run_content payload 형태로 정규화돼 들어온다(source 만 추가).
  const contentPayload = { source: 'hospital_web', ...(job.payload ?? {}) };
  const { error } = await srvc
    .schema('health_report')
    .from('generated_run_content')
    .upsert(
      {
        parse_run_id: runId,
        content_type: job.kind,
        payload: contentPayload,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'parse_run_id,content_type' },
    );
  if (error) throw new Error(`콘텐츠 저장 실패: ${error.message}`);
}

/**
 * extract_job 하나를 처리한다. after()/cron 어느 쪽에서 불려도 안전(원자적 점유 + 멱등).
 * 점유 실패(다른 워커가 처리 중/완료)면 조용히 반환.
 */
export async function processExtractJob(jobId: string): Promise<void> {
  const srvc = createServiceRoleClient();

  const { data: claimed, error: claimErr } = await srvc
    .schema('health_report')
    .rpc('claim_extract_job', { p_id: jobId });
  if (claimErr) {
    console.error('[extract-job] claim error', jobId, claimErr.message);
    return;
  }
  const job = claimed as ExtractJob | null;
  if (!job || !job.id) return; // 점유 실패 = 이미 처리 중/완료

  try {
    let runId = job.run_id;
    if (!runId) {
      runId = await callChartApiExtract(job);
      await srvc
        .schema('health_report')
        .from('extract_jobs')
        .update({ run_id: runId, updated_at: new Date().toISOString() })
        .eq('id', job.id);
    }

    await saveContent(srvc, job, runId);

    // 토큰 차감(성공 시 1회). token_deducted 로 중복 차감 방지. 실패해도 best-effort.
    if (job.token_cost > 0 && !job.token_deducted) {
      try {
        await srvc.schema('core').rpc('token_deduct', {
          p_user_id: job.user_id,
          p_amount: job.token_cost,
          p_reason: job.kind === 'blog_case' ? 'blog_case' : 'health_report',
          p_hospital_id: job.hospital_id,
        });
      } catch (e) {
        console.error('[extract-job] token_deduct failed', jobId, e);
      }
      await srvc
        .schema('health_report')
        .from('extract_jobs')
        .update({ token_deducted: true })
        .eq('id', job.id);
    }

    await srvc
      .schema('health_report')
      .from('extract_jobs')
      .update({ status: 'done', error_text: null, updated_at: new Date().toISOString() })
      .eq('id', job.id);
    console.log('[extract-job] done', jobId, 'runId=', runId);

    // 케이스 이미지 자동 임포트·분석 — admin 이미지 탭을 안 열어도 백그라운드로 돌도록.
    // admin from-hospital 을 service role key 로 server-to-server 호출(멱등). ADMIN_WEB_URL 미설정 시 스킵
    // (그 경우 admin 이미지 탭 열람 시 기존 트리거가 폴백으로 동작).
    const adminUrl = process.env.ADMIN_WEB_URL;
    if (adminUrl) {
      try {
        await fetch(`${adminUrl}/api/admin/runs/${encodeURIComponent(runId)}/case-images/from-hospital`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''}` },
        });
      } catch (e) {
        console.error('[extract-job] case-image import trigger failed (non-blocking)', jobId, e);
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const finalStatus = job.attempts >= MAX_ATTEMPTS ? 'error' : 'queued';
    await srvc
      .schema('health_report')
      .from('extract_jobs')
      .update({ status: finalStatus, error_text: msg, updated_at: new Date().toISOString() })
      .eq('id', job.id);
    console.error('[extract-job] failed', jobId, `(attempts=${job.attempts}, →${finalStatus})`, msg);
    // 재시도 소진(최종 error)일 때만 운영자에게 알림 — 재시도 가능(queued)은 도배 방지로 제외.
    if (finalStatus === 'error') {
      const source = job.kind === 'blog_case' ? '진료케이스 추출' : '건강검진 추출';
      await notifyAdminError({ source, message: `${msg} · job ${job.id}`, link: '/admin/health-report', hospitalId: job.hospital_id });
    }
  }
}
