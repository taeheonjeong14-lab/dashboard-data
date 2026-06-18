import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const VALID_STEPS = ['blog_metrics', 'smartplace', 'keyword_rank', 'searchad', 'place_reviews'];

type Schedule = {
  id: string;
  enabled: boolean;
  steps: string[] | null;
  scope: 'all' | 'hospitals';
  hospital_ids: string[] | null;
  frequency: 'daily' | 'weekly';
  hour: number;
  weekdays: number[] | null;
  searchad_start_date: string | null;
  searchad_end_date: string | null;
  searchad_campaign_ids: string[] | null;
  last_fired_at: string | null;
};

// Vercel 크론은 CRON_SECRET 이 설정돼 있으면 Authorization: Bearer <CRON_SECRET> 를 붙여 호출한다.
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // 미설정 시 게이트 없음(설정 권장)
  const auth = req.headers.get('authorization') || '';
  return auth === `Bearer ${secret}`;
}

// steps[] → collect_jobs.steps_filter (전체(빈배열/5개)면 null = 모든 step)
function stepsFilter(steps: string[] | null): string[] | null {
  const s = (steps ?? []).filter((x) => VALID_STEPS.includes(x));
  if (s.length === 0 || s.length >= VALID_STEPS.length) return null;
  return s;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // KST(UTC+9) 기준 현재 시/요일
  const nowMs = Date.now();
  const kst = new Date(nowMs + 9 * 3600 * 1000);
  const kstHour = kst.getUTCHours();
  const kstWeekday = kst.getUTCDay(); // 0=일
  const hourSlot = Math.floor(nowMs / 3600000); // 매시 중복 발화 방지용

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .schema('analytics')
    .from('collect_schedules')
    .select('*')
    .eq('enabled', true);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const schedules = (data ?? []) as Schedule[];
  const fired: { id: string; jobs: number }[] = [];

  for (const sc of schedules) {
    if (sc.hour !== kstHour) continue;
    if (sc.frequency === 'weekly' && !(sc.weekdays ?? []).includes(kstWeekday)) continue;
    // 이번 시(hour) 안에 이미 발화했으면 건너뜀
    if (sc.last_fired_at && Math.floor(new Date(sc.last_fired_at).getTime() / 3600000) === hourSlot) continue;

    const filter = stepsFilter(sc.steps);
    const usesSearchad = !filter || filter.includes('searchad');
    const searchadCols = usesSearchad && sc.searchad_start_date && sc.searchad_end_date
      ? { searchad_start_date: sc.searchad_start_date, searchad_end_date: sc.searchad_end_date }
      : {};
    const campaignCols = usesSearchad && sc.searchad_campaign_ids && sc.searchad_campaign_ids.length > 0
      ? { searchad_campaign_ids: sc.searchad_campaign_ids }
      : {};

    let rows: Record<string, unknown>[];
    if (sc.scope === 'hospitals' && (sc.hospital_ids?.length ?? 0) > 0) {
      rows = (sc.hospital_ids as string[]).map((hid) => ({
        hospital_id: hid,
        ...(filter ? { steps_filter: filter } : {}),
        ...searchadCols,
        ...campaignCols,
      }));
    } else {
      // 전체 병원 = hospital_id 없는 배치 잡 1건 (워커가 collect-all-batch 실행)
      rows = [{
        ...(filter ? { steps_filter: filter } : {}),
        ...searchadCols,
        ...campaignCols,
      }];
    }

    const { error: insErr } = await supabase.schema('analytics').from('collect_jobs').insert(rows);
    if (insErr) {
      console.error('[cron/collect] insert error', sc.id, insErr.message);
      continue;
    }
    await supabase.schema('analytics').from('collect_schedules')
      .update({ last_fired_at: new Date().toISOString() }).eq('id', sc.id);
    fired.push({ id: sc.id, jobs: rows.length });
  }

  return NextResponse.json({ ok: true, kstHour, kstWeekday, fired });
}
