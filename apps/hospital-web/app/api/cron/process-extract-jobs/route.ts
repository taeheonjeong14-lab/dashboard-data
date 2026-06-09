import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { processExtractJob } from '@/lib/extract-jobs/process';

// 안전망 크론: submit 의 after() 가 크래시/재활용으로 누락한 job, 또는 멈춘 processing job 을 재처리한다.
// 실제 점유/중복방지는 claim_extract_job RPC 가 원자적으로 보장하므로 여기 선별은 느슨해도 안전.
export const maxDuration = 800;
export const dynamic = 'force-dynamic';

const MAX_ATTEMPTS = 3;
const STALE_SECONDS = 900; // 15분 이상 멈춘 processing 은 죽은 것으로 간주
const BATCH = 3;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  const srvc = createServiceRoleClient();
  const staleBefore = new Date(Date.now() - STALE_SECONDS * 1000).toISOString();

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
