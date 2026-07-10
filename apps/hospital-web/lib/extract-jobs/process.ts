// 비동기 추출 워커 (extract_jobs). 변경 시 hospital-web 재배포 트리거됨.
import { setGlobalDispatcher, Agent } from 'undici';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { notifyAdminError } from '@/lib/notify';
import { logError } from '@/lib/error-log';

// chart-api 추출은 오래 걸리므로 fetch 타임아웃을 800초로(undici 기본 300초 우회).
setGlobalDispatcher(new Agent({ headersTimeout: 800_000, bodyTimeout: 800_000, connectTimeout: 20_000 }));

const CHART_API_URL = process.env.CHART_API_URL ?? 'https://chart-api-five.vercel.app';
const CHART_API_KEY = process.env.CHART_API_KEY ?? '';
const MAX_ATTEMPTS = 3;

/**
 * 재시도해도 결과가 같은 오류. 예: "PDF가 너무 깁니다 (43페이지)" — 몇 번을 올려도 43페이지다.
 * 이걸 일시적 오류와 섞어 재시도하면, 그동안 사용자 화면엔 '분석 중…'만 떠서
 * 정작 고칠 수 있는 원인(페이지 잘라 올리기)을 한참 뒤에야 알게 된다.
 */
class PermanentExtractError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'PermanentExtractError';
  }
}

/** 4xx 는 요청 자체가 잘못된 것 → 재시도 무의미. 단 408(타임아웃)·429(한도)는 시간이 해결한다. */
export function isPermanentStatus(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

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
  /** 설정 시 재추출(덮어쓰기): 새 run 대신 이 run 을 덮어쓴다. */
  replace_run_id: string | null;
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
  // 재추출(덮어쓰기): 새 run 대신 기존 run 을 덮어쓰도록 chart-api 에 전달.
  if (job.replace_run_id) params.set('replaceRunId', job.replace_run_id);
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
    const message = timedOut
      ? '파일 용량 초과 - PDF파일이 너무 용량이 크거나 이미지 파일이 너무 많습니다.'
      : (data.error ?? `차트 분석 실패 (${res.status})`);

    // 페이지 수 초과(413) 같은 4xx 는 재시도해도 같은 결과다. 즉시 확정 실패로 올린다.
    if (!timedOut && !res.ok && isPermanentStatus(res.status)) {
      throw new PermanentExtractError(message, res.status);
    }
    throw new Error(message);
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

type AdditionalDocResult = { filename: string; path: string; bucket: string; mime_type: string; text: string; summary?: string; error?: string };

// 추가 자료(외부 검사 결과서 등) — payload.additional_docs 의 각 파일을 chart-api 로 텍스트 추출.
// 파일별 실패는 그 파일만 error 로 기록(케이스 추출은 계속). 비전 OCR 비용은 케이스 run 에 귀속해 과금.
async function enrichAdditionalDocs(job: ExtractJob, runId: string): Promise<AdditionalDocResult[] | null> {
  const raw = (job.payload as { additional_docs?: unknown })?.additional_docs;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: AdditionalDocResult[] = [];
  for (const d of raw as Array<Record<string, unknown>>) {
    const path = String(d?.path ?? '').trim();
    if (!path) continue;
    const filename = String(d?.filename ?? '').trim() || path.split('/').pop() || 'document';
    const mimeType = String(d?.mime_type ?? d?.mimeType ?? '').trim();
    try {
      const res = await fetch(`${CHART_API_URL}/api/content/case-doc-extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CHART_API_KEY}` },
        body: JSON.stringify({ storagePath: path, bucket: job.storage_bucket, mimeType, fileName: filename, hospitalId: job.hospital_id, runId }),
      });
      const data = (await res.json().catch(() => ({}))) as { text?: string; summary?: string; error?: string };
      if (res.ok && typeof data.text === 'string') {
        out.push({ filename, path, bucket: job.storage_bucket, mime_type: mimeType, text: data.text, summary: typeof data.summary === 'string' ? data.summary : '' });
      } else {
        out.push({ filename, path, bucket: job.storage_bucket, mime_type: mimeType, text: '', error: data.error || `추출 실패 (${res.status})` });
      }
    } catch (e) {
      out.push({ filename, path, bucket: job.storage_bucket, mime_type: mimeType, text: '', error: e instanceof Error ? e.message : '추출 실패' });
    }
  }
  return out;
}

// 재추출(덮어쓰기) 경로 — 개요/이미지는 건드리지 않고 generated_run_content payload 의 additional_docs 만 갱신.
async function mergeAdditionalDocs(srvc: Srvc, runId: string, docs: AdditionalDocResult[]): Promise<void> {
  const { data } = await srvc
    .schema('health_report')
    .from('generated_run_content')
    .select('payload')
    .eq('parse_run_id', runId)
    .eq('content_type', 'blog_case')
    .maybeSingle();
  const base =
    data?.payload && typeof data.payload === 'object' && !Array.isArray(data.payload)
      ? (data.payload as Record<string, unknown>)
      : {};
  const next = { ...base, additional_docs: docs };
  const { error } = await srvc
    .schema('health_report')
    .from('generated_run_content')
    .upsert(
      { parse_run_id: runId, content_type: 'blog_case', payload: next, updated_at: new Date().toISOString() },
      { onConflict: 'parse_run_id,content_type' },
    );
  if (error) throw new Error(`추가 자료 저장 실패: ${error.message}`);
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

    // 추가 자료(외부 검사 결과서) 텍스트 추출. 파일별 실패는 그 파일만 기록(케이스는 계속 진행).
    const enrichedDocs = await enrichAdditionalDocs(job, runId).catch((e) => {
      console.error('[extract-job] additional docs extract failed (non-blocking)', jobId, e);
      return null;
    });

    // 재추출(덮어쓰기)이면 개요/이미지는 건드리지 않되, 추가 자료는 갱신한다.
    if (!job.replace_run_id) {
      if (enrichedDocs) (job.payload as Record<string, unknown>).additional_docs = enrichedDocs;
      await saveContent(srvc, job, runId);
    } else if (enrichedDocs) {
      await mergeAdditionalDocs(srvc, runId, enrichedDocs);
    }

    // 토큰 차감(성공 시 1회). token_deducted 로 중복 차감 방지. 실패해도 best-effort.
    // 재추출은 token_cost=0 으로 적재돼 아래 조건에서 자동 스킵된다(과금 없음).
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
    // 재추출이면 이미 원업로드 때 임포트됨 → 스킵(중복/재분석 방지).
    const adminUrl = process.env.ADMIN_WEB_URL;
    if (adminUrl && !job.replace_run_id) {
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
    // 영구 오류는 남은 재시도 횟수와 무관하게 바로 확정 실패 — 사용자가 곧장 원인을 본다.
    const permanent = e instanceof PermanentExtractError;
    const finalStatus = permanent || job.attempts >= MAX_ATTEMPTS ? 'error' : 'queued';
    await srvc
      .schema('health_report')
      .from('extract_jobs')
      .update({ status: finalStatus, error_text: msg, updated_at: new Date().toISOString() })
      .eq('id', job.id);
    console.error('[extract-job] failed', jobId, `(attempts=${job.attempts}, →${finalStatus})`, msg);

    // admin 에러 로그(core.error_logs)에도 남긴다.
    // 이 잡은 라우트가 아니라 백그라운드 워커라, 라우트 래퍼도 instrumentation 도 잡지 못한다.
    // 그런데 병원에서 가장 자주 나는 실패가 바로 여기(예: 43페이지 PDF)라 로그가 비어 있었다.
    // 재시도까지 전부 남긴다 — 몇 번 만에 포기했는지가 진단에 필요하다.
    const feature = job.kind === 'blog_case' ? '진료케이스 추출' : '건강검진 추출';
    await logError({
      source: 'server',
      route: `extract-job/${job.kind}`,
      feature,
      statusCode: permanent ? (e as PermanentExtractError).status : null,
      message: msg,
      stack: e instanceof Error ? (e.stack ?? null) : null,
      hospitalId: job.hospital_id,
      userId: job.user_id,
      // payload 에는 개요·강조사항 등 진료 서술이 들어 있어 통째로 싣지 않는다.
      context: { jobId: job.id, kind: job.kind, attempts: job.attempts, finalStatus, permanent, pdfCount: job.storage_paths?.length ?? 0 },
    });

    // 재시도 소진(최종 error)일 때만 운영자에게 알림 — 재시도 가능(queued)은 도배 방지로 제외.
    // 영구 오류(4xx)는 사용자 입력 문제(예: 43페이지 PDF)라 운영 장애가 아니다. 종을 울리지 않는다.
    if (finalStatus === 'error' && !permanent) {
      await notifyAdminError({ source: feature, message: `${msg} · job ${job.id}`, link: '/admin/health-report', hospitalId: job.hospital_id });
    }
  }
}
