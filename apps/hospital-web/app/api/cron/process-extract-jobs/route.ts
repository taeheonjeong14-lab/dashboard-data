import { NextRequest, NextResponse } from 'next/server';
import { withErrorLog } from '@/lib/with-error-log';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { processExtractJob } from '@/lib/extract-jobs/process';

// 안전망 크론: submit 의 after() 가 크래시/재활용으로 누락한 job, 또는 멈춘 processing job 을 재처리한다.
// 실제 점유/중복방지는 claim_extract_job RPC 가 원자적으로 보장하므로 여기 선별은 느슨해도 안전.
export const maxDuration = 800;
export const dynamic = 'force-dynamic';

const MAX_ATTEMPTS = 3;
const STALE_SECONDS = 900; // 15분 이상 멈춘 processing 은 죽은 것으로 간주
const BATCH = 3;

export const GET = withErrorLog({ route: '/api/cron/process-extract-jobs', feature: '재추출 잡 처리(크론)' }, handleGET);

async function handleGET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  const srvc = createServiceRoleClient();
  const staleBefore = new Date(Date.now() - STALE_SECONDS * 1000).toISOString();

  // ── 죽은 processing 잡을 error 로 확정한다 ─────────────────────────────
  // 워커 함수가 강제 종료되면(타임아웃·OOM) 실패 처리 코드에 도달하지 못해 status 가 processing 인 채로 남는다.
  // 아래 재시도 목록은 attempts < MAX 만 집으므로, 한도를 넘긴 잡은 영영 processing 으로 방치되고
  // (에러 로그도 없고) admin 진행바는 무한히 돌게 된다. → 여기서 명시적으로 실패로 끝맺는다.
  try {
    const { data: dead } = await srvc
      .schema('health_report')
      .from('extract_jobs')
      .select('id, attempts')
      .eq('status', 'processing')
      .gte('attempts', MAX_ATTEMPTS)
      .lt('updated_at', staleBefore)
      .limit(20);
    for (const j of (dead ?? []) as { id: string; attempts: number }[]) {
      await srvc
        .schema('health_report')
        .from('extract_jobs')
        .update({
          status: 'error',
          error_text: `추출이 시간 내에 끝나지 않았습니다(재시도 ${j.attempts}회 모두 중단). PDF 가 너무 크거나 처리 중 함수가 종료됐을 수 있습니다.`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', j.id)
        .eq('status', 'processing'); // 그새 살아나 done 이 됐다면 덮어쓰지 않는다
      console.warn('[cron] 죽은 processing 잡을 error 로 확정:', j.id, `attempts=${j.attempts}`);
    }
  } catch (e) {
    console.error('[cron] 죽은 잡 정리 실패(무시하고 계속):', e);
  }

  let list: { id: string }[] = [];
  try {
    const { data } = await srvc
      .schema('health_report')
      .from('extract_jobs')
      .select('id')
      .lt('attempts', MAX_ATTEMPTS)
      .or(`status.eq.queued,and(status.eq.processing,updated_at.lt.${staleBefore})`)
      .order('created_at', { ascending: true })
      .limit(BATCH);
    list = (data ?? []) as { id: string }[];
  } catch (e) {
    console.error('[cron] list extract_jobs error', e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'list error' }, { status: 500 });
  }

  for (const j of list) {
    await processExtractJob(j.id); // 점유 실패(이미 처리 중)면 내부에서 조용히 반환
  }

  return NextResponse.json({ ok: true, picked: list.length });
}
