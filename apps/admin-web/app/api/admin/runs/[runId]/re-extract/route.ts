import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

export const dynamic = 'force-dynamic';

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
      payload: {},
      status: 'queued',
      token_cost: 0,
      replace_run_id: runId,
    })
    .select('id')
    .single();
  if (jobErr || !job) {
    return NextResponse.json({ error: `재추출 잡 생성 실패: ${jobErr?.message ?? 'unknown'}` }, { status: 500 });
  }

  // 4) 즉시 처리 트리거(best-effort) — 실패해도 스케줄 크론이 집어감.
  const hospitalUrl = process.env.HOSPITAL_WEB_URL;
  const cronSecret = process.env.CRON_SECRET;
  if (hospitalUrl) {
    void fetch(`${hospitalUrl}/api/cron/process-extract-jobs`, {
      method: 'GET',
      headers: cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {},
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true, jobId: job.id });
}
