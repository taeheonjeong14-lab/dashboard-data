import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { getAdminWebPgPool } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

// SearchAd 기간 지정 수집 잡의 '날짜별 수집 여부'를 돌려준다.
// (중간에 종료된 잡이 어디까지 수집됐고 어디부터 안 됐는지 확인용)
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const { jobId } = await params;
  if (!/^[0-9a-f-]{8,36}$/i.test(jobId)) {
    return NextResponse.json({ error: '유효하지 않은 jobId입니다.' }, { status: 400 });
  }

  const pool = getAdminWebPgPool();

  // date 컬럼은 ::text로 받아 pg가 JS Date로 파싱해 생기는 오프셋/타입 문제를 피한다.
  const jobRes = await pool.query<{
    hospital_id: string | null;
    start: string | null;
    end: string | null;
  }>(
    `SELECT hospital_id,
            searchad_start_date::text AS start,
            searchad_end_date::text   AS end
       FROM analytics.collect_jobs
      WHERE id = $1`,
    [jobId],
  );

  const job = jobRes.rows[0];
  if (!job) {
    return NextResponse.json({ error: 'Job을 찾을 수 없습니다.' }, { status: 404 });
  }

  // 기간 지정이 아닌 잡(자동 수집)은 목표 구간이 없어 날짜별 표시가 불가능.
  if (!job.hospital_id || !job.start || !job.end) {
    return NextResponse.json({ applicable: false });
  }

  const start = job.start.slice(0, 10);
  const end = job.end.slice(0, 10);

  const presentRes = await pool.query<{ d: string }>(
    `SELECT DISTINCT metric_date::text AS d
       FROM analytics.analytics_searchad_daily_metrics
      WHERE hospital_id = $1
        AND metric_date BETWEEN $2 AND $3`,
    [job.hospital_id, start, end],
  );
  const present = new Set(presentRes.rows.map((r) => r.d.slice(0, 10)));

  const days: { date: string; collected: boolean }[] = [];
  const cur = new Date(`${start}T00:00:00Z`);
  const endD = new Date(`${end}T00:00:00Z`);
  while (cur <= endD) {
    const ds = cur.toISOString().slice(0, 10);
    days.push({ date: ds, collected: present.has(ds) });
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  const collectedDays = days.filter((d) => d.collected).length;
  // 수집된 마지막 날 / 안 된 첫 날(연속 기준) 힌트
  const firstMissing = days.find((d) => !d.collected)?.date ?? null;
  let lastCollected: string | null = null;
  for (const d of days) {
    if (d.collected) lastCollected = d.date;
  }

  return NextResponse.json({
    applicable: true,
    start,
    end,
    totalDays: days.length,
    collectedDays,
    firstMissing,
    lastCollected,
    days,
  });
}
