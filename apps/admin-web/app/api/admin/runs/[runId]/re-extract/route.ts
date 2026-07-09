import { NextRequest, NextResponse, after } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

export const dynamic = 'force-dynamic';

// GET /api/admin/runs/[runId]/re-extract — 이 run 의 최신 재추출 잡 상태 조회(진행바 폴링용).
// replace_run_id 로 찾으므로 jobId 없이도(페이지 새로고침 후에도) 진행 중 잡을 이어서 추적한다.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const { runId } = await params;
  const supabase = createServiceRoleClient();
  const { data: job } = await supabase
    .schema('health_report')
    .from('extract_jobs')
    .select('id, status, attempts, error_text, created_at, updated_at')
    .eq('replace_run_id', runId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!job) return NextResponse.json({ status: null });
  return NextResponse.json({
    jobId: job.id,
    status: job.status, // queued | processing | done | error
    attempts: job.attempts,
    errorText: job.error_text ?? null,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  });
}

// POST /api/admin/runs/[runId]/re-extract
// 이미 업로드된 원본 PDF 로 추출을 처음부터 다시 시도해 "기존 run 을 덮어쓴다"(비동기 잡).
// 병원에 재업로드 요청을 못 하는 상황에서, admin 이 백단 추출 실패를 직접 복구하기 위함.
// 과금 없음(token_cost=0). 잡에 replace_run_id 를 실어, 워커가 chart-api 에 replaceRunId 로 전달 → 덮어쓰기.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const { runId } = await params;
  const supabase = createServiceRoleClient();

  // 1) run + 원본 PDF 경로(raw_payload.sourceStorage) 조회
  const { data: run, error: runErr } = await supabase
    .schema('chart_pdf')
    .from('parse_runs')
    .select('id, hospital_id, document_id, raw_payload')
    .eq('id', runId)
    .single();
  if (runErr || !run) {
    return NextResponse.json({ error: '해당 run 을 찾을 수 없습니다.' }, { status: 404 });
  }

  const sourceStorage = (
    run.raw_payload as { sourceStorage?: { bucket?: string; paths?: string[]; product?: string | null } } | null
  )?.sourceStorage;
  if (!sourceStorage?.bucket || !Array.isArray(sourceStorage.paths) || sourceStorage.paths.length === 0) {
    return NextResponse.json(
      { error: '이 추출에는 원본 PDF 경로가 저장돼 있지 않습니다(재추출 기능 추가 이전 추출분). 재추출할 수 없습니다.' },
      { status: 400 },
    );
  }
  if (!run.hospital_id) {
    return NextResponse.json({ error: 'run 에 병원 정보가 없습니다.' }, { status: 400 });
  }

  // 2) chart_type 조회(documents)
  const { data: doc } = await supabase
    .schema('chart_pdf')
    .from('documents')
    .select('chart_type')
    .eq('id', run.document_id as string)
    .single();
  const chartType = (doc?.chart_type as string) || 'intovet';

  // 3) 재추출 잡 적재 — token_cost=0(과금 없음) + replace_run_id(덮어쓰기)
  const kind = sourceStorage.product === 'case_blog' ? 'blog_case' : 'hospital_notes';

  // 진료케이스면 기존 "추가 자료" 경로를 잡 payload 에 실어, 워커가 다시 추출·요약하도록 한다.
  // (이게 없으면 재추출이 원본 차트만 다시 파싱하고 추가 자료·요약은 손대지 않아, 요약이 안 채워짐.)
  let additionalDocs: Array<{ path: string; filename: string; mime_type: string }> = [];
  if (kind === 'blog_case') {
    const { data: gen } = await supabase
      .schema('health_report')
      .from('generated_run_content')
      .select('payload')
      .eq('parse_run_id', runId)
      .eq('content_type', 'blog_case')
      .maybeSingle();
    const docs = (gen?.payload as { additional_docs?: unknown } | null)?.additional_docs;
    if (Array.isArray(docs)) {
      additionalDocs = docs
        .map((d) => {
          const dd = (d ?? {}) as Record<string, unknown>;
          return {
            path: String(dd.path ?? '').trim(),
            filename: String(dd.filename ?? '').trim(),
            mime_type: String(dd.mime_type ?? dd.mimeType ?? '').trim(),
          };
        })
        .filter((d) => d.path);
    }
  }

  const { data: job, error: jobErr } = await supabase
    .schema('health_report')
    .from('extract_jobs')
    .insert({
      hospital_id: run.hospital_id,
      user_id: run.hospital_id, // 재추출은 토큰 차감 없음 → user_id 미사용(병원 id 로 채움)
      chart_type: chartType,
      kind,
      storage_bucket: sourceStorage.bucket,
      storage_paths: sourceStorage.paths,
      payload: additionalDocs.length ? { additional_docs: additionalDocs } : {},
      status: 'queued',
      token_cost: 0,
      replace_run_id: runId,
    })
    .select('id')
    .single();
  if (jobErr || !job) {
    return NextResponse.json({ error: `재추출 잡 생성 실패: ${jobErr?.message ?? 'unknown'}` }, { status: 500 });
  }

  // 4) 즉시 처리 트리거 — after() 로 응답 반환 후에도 함수를 살려 트리거가 확실히 전달되게 한다.
  //    (기존 `void fetch` fire-and-forget 은 서버리스에서 응답 직후 함수가 얼면서 요청이 끊겨,
  //     재추출 잡이 워커에 전달되지 않고 queued 로 방치되던 원인. 실패해도 본 응답엔 영향 없음.)
  //    ⚠ HOSPITAL_WEB_URL(+CRON_SECRET) 가 admin 프로드 env 에 설정돼야 동작. 미설정 시 워커 미트리거.
  const hospitalUrl = process.env.HOSPITAL_WEB_URL?.replace(/\/$/, ''); // 끝 슬래시 제거(// 중복 방지)
  const cronSecret = process.env.CRON_SECRET;
  if (hospitalUrl) {
    after(async () => {
      try {
        const r = await fetch(`${hospitalUrl}/api/cron/process-extract-jobs`, {
          method: 'GET',
          headers: cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {},
        });
        if (!r.ok) console.warn(`[re-extract] 워커 트리거 응답 ${r.status}`);
      } catch (e) {
        console.warn('[re-extract] 워커 트리거 실패:', e instanceof Error ? e.message : String(e));
      }
    });
  } else {
    console.warn('[re-extract] HOSPITAL_WEB_URL 미설정 — 워커 즉시 트리거 생략(잡이 queued 로 남음)');
  }

  return NextResponse.json({ ok: true, jobId: job.id });
}
