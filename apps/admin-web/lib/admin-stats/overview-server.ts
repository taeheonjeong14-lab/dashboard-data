/**
 * 전체 현황 보드 — 병원별로 "최근 4주 vs 직전 4주" 변화를 한 줄로 만든다.
 *
 * 목적은 병원끼리 비교가 아니다(규모가 제각각이라 절대치 비교는 의미 없다).
 * 각 병원을 **자기 과거와만** 비교해, 대응이 필요한 병원을 위로 끌어올리는 것.
 *
 * 데이터가 안 들어온 것과 지표가 떨어진 것을 구분해야 오탐이 없다 → freshness(마지막 수집일)를 함께 낸다.
 */
import { createClient } from '@supabase/supabase-js';

const WINDOW_DAYS = 28;

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase 환경변수가 없습니다.');
  return createClient(url, key, { auth: { persistSession: false } });
}

function todayKeySeoul(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
}
function addDays(dateKey: string, delta: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + delta * 86400000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}
function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function dateKeyOf(v: unknown): string {
  return String(v ?? '').slice(0, 10);
}

/** 지표 하나의 두 기간 합계와 변화율. 직전 기간이 0/없음이면 변화율은 null(색칠하지 않는다). */
export type MetricDelta = {
  current: number;
  previous: number;
  changePct: number | null;
};

export type OverviewRow = {
  hospitalId: string;
  hospitalName: string;
  metrics: {
    newPatients: MetricDelta;
    sales: MetricDelta;
    visits: MetricDelta;
    placeInflow: MetricDelta;
    blogViews: MetricDelta;
    adClicks: MetricDelta;
  };
  /** 순위가 떨어진 키워드 수(블로그·플레이스 합) — 자세한 건 키워드 순위 보드에서. */
  rankDrops: number;
  /** 최근 6개월 안에 새로 달린 부정 리뷰 수(최근 4주). */
  newNegativeReviews: number;
  /** 데이터 신선도 — 마지막 수집일(없으면 null). 오래됐으면 '지표 하락'이 아니라 '수집 중단'이다. */
  freshness: {
    management: string | null;
    place: string | null;
    blog: string | null;
    ads: string | null;
  };
};

function delta(cur: number, prev: number): MetricDelta {
  const changePct = prev > 0 ? ((cur - prev) / prev) * 100 : null;
  return { current: cur, previous: prev, changePct };
}

/** rows 를 병원별로 두 기간 합계로 접는다. */
function foldByHospital(
  rows: Record<string, unknown>[],
  hospitalKey: string,
  dateKey: string,
  valueKeys: string[],
  curStart: string,
  prevStart: string,
): Map<string, { cur: number; prev: number; last: string | null }> {
  const out = new Map<string, { cur: number; prev: number; last: string | null }>();
  for (const r of rows) {
    const hid = String(r[hospitalKey] ?? '');
    if (!hid) continue;
    const dk = dateKeyOf(r[dateKey]);
    if (!dk) continue;
    let v: number | null = null;
    for (const k of valueKeys) {
      if (k in r) {
        const n = num(r[k]);
        if (n != null) { v = n; break; }
      }
    }
    const acc = out.get(hid) ?? { cur: 0, prev: 0, last: null };
    if (dk >= curStart) acc.cur += v ?? 0;
    else if (dk >= prevStart) acc.prev += v ?? 0;
    if (v != null && (acc.last == null || dk > acc.last)) acc.last = dk;
    out.set(hid, acc);
  }
  return out;
}

async function selectAll(
  supabase: ReturnType<typeof getSupabase>,
  table: string,
  cols: string,
  since: string,
  dateCol: string,
  /** DB 단에서 미리 거를 조건(예: 광고는 캠페인 레벨만 — 키워드 행까지 끌면 수십만 행이라 타임아웃난다). */
  eq?: Record<string, string>,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    let q = supabase.schema('analytics').from(table).select(cols).gte(dateCol, since);
    for (const [k, v] of Object.entries(eq ?? {})) q = q.eq(k, v);
    const { data, error } = await q.range(from, from + size - 1);
    if (error) throw new Error(`${table}: ${error.message}${error.hint ? ` (${error.hint})` : ''}`);
    const chunk = (data ?? []) as unknown as Record<string, unknown>[];
    out.push(...chunk);
    if (chunk.length < size) break;
  }
  return out;
}

export async function fetchOverviewRows(): Promise<OverviewRow[]> {
  const supabase = getSupabase();
  const today = todayKeySeoul();
  const curStart = addDays(today, -WINDOW_DAYS + 1);
  const prevStart = addDays(today, -WINDOW_DAYS * 2 + 1);

  // 병원 목록(코어) — 이름만 필요
  const { data: hospitalRows, error: hErr } = await supabase
    .schema('core')
    .from('hospitals')
    .select('id,name')
    .order('name', { ascending: true });
  if (hErr) throw new Error(`core.hospitals: ${hErr.message}`);
  const hospitals = (hospitalRows ?? []) as { id: string; name: string | null }[];

  const [kpis, place, blog, ads, blogRanks, placeRanks, reviews] = await Promise.all([
    selectAll(supabase, 'chart_kpis_period_view', 'hospital_id,period_start_date,period_type,sales_amount,visit_count,new_customer_count', prevStart, 'period_start_date'),
    selectAll(supabase, 'chart_place_period_view', 'hospital_id,period_date,period_type,smartplace_inflow', prevStart, 'period_date'),
    selectAll(supabase, 'chart_blog_period_view', 'hospital_id,metric_date,period_type,blog_views,blog_unique_visitors', prevStart, 'metric_date'),
    // 광고: 캠페인 레벨(keyword_id='')만. 키워드 행까지 가져오면 행이 수십만이라 DB 가 타임아웃난다.
    selectAll(supabase, 'analytics_searchad_daily_metrics', 'hospital_id,metric_date,clicks', prevStart, 'metric_date', { keyword_id: '' }),
    selectAll(supabase, 'analytics_blog_keyword_ranks_daily_view', 'hospital_id,metric_date,keyword,blog_rank_tab,blog_rank_general,blog_rank_integrated,blog_rank_pet_popular', prevStart, 'metric_date'),
    selectAll(supabase, 'analytics_place_keyword_ranks', 'hospital_id,metric_date,keyword,rank_value', prevStart, 'metric_date'),
    selectAll(supabase, 'analytics_place_reviews', 'hospital_id,visit_date,review_date,sentiment', curStart, 'visit_date'),
  ]);

  // 경영지표는 일(day) 단위 행만 합산한다(월/연 행이 섞이면 이중 계산).
  const kpiDays = kpis.filter((r) => String(r.period_type ?? '').toLowerCase() === 'day');
  const placeDays = place.filter((r) => String(r.period_type ?? '').toLowerCase() === 'day');
  const blogDays = blog.filter((r) => String(r.period_type ?? '').toLowerCase() === 'day');
  const adCampaign = ads; // 이미 DB 에서 캠페인 레벨만 가져왔다

  const sales = foldByHospital(kpiDays, 'hospital_id', 'period_start_date', ['sales_amount'], curStart, prevStart);
  const visits = foldByHospital(kpiDays, 'hospital_id', 'period_start_date', ['visit_count'], curStart, prevStart);
  const newPat = foldByHospital(kpiDays, 'hospital_id', 'period_start_date', ['new_customer_count'], curStart, prevStart);
  const inflow = foldByHospital(placeDays, 'hospital_id', 'period_date', ['smartplace_inflow'], curStart, prevStart);
  const views = foldByHospital(blogDays, 'hospital_id', 'metric_date', ['blog_views'], curStart, prevStart);
  const clicks = foldByHospital(adCampaign, 'hospital_id', 'metric_date', ['clicks'], curStart, prevStart);

  // 순위 하락 수 — 최신 스냅샷 vs 4주 전 스냅샷(가장 가까운 날짜).
  const rankDrops = countRankDrops(blogRanks, placeRanks, today);

  // 최근 4주 신규 부정 리뷰
  const negatives = new Map<string, number>();
  for (const r of reviews) {
    const s = String(r.sentiment ?? '');
    if (s !== 'negative' && s !== 'strong_negative') continue;
    const hid = String(r.hospital_id ?? '');
    if (!hid) continue;
    negatives.set(hid, (negatives.get(hid) ?? 0) + 1);
  }

  const empty = { cur: 0, prev: 0, last: null as string | null };
  return hospitals.map((h) => {
    const s = sales.get(h.id) ?? empty;
    const v = visits.get(h.id) ?? empty;
    const n = newPat.get(h.id) ?? empty;
    const i = inflow.get(h.id) ?? empty;
    const b = views.get(h.id) ?? empty;
    const c = clicks.get(h.id) ?? empty;
    return {
      hospitalId: h.id,
      hospitalName: h.name ?? '(이름 없음)',
      metrics: {
        newPatients: delta(n.cur, n.prev),
        sales: delta(s.cur, s.prev),
        visits: delta(v.cur, v.prev),
        placeInflow: delta(i.cur, i.prev),
        blogViews: delta(b.cur, b.prev),
        adClicks: delta(c.cur, c.prev),
      },
      rankDrops: rankDrops.get(h.id) ?? 0,
      newNegativeReviews: negatives.get(h.id) ?? 0,
      freshness: {
        management: s.last ?? v.last ?? n.last,
        place: i.last,
        blog: b.last,
        ads: c.last,
      },
    };
  });
}

/** 병원별 '4주 전보다 순위가 떨어진 키워드 수'(블로그 최상위 순위 + 플레이스). */
function countRankDrops(
  blogRows: Record<string, unknown>[],
  placeRows: Record<string, unknown>[],
  today: string,
): Map<string, number> {
  const target = addDays(today, -28);
  const drops = new Map<string, number>();

  const bump = (hid: string) => drops.set(hid, (drops.get(hid) ?? 0) + 1);

  const best = (r: Record<string, unknown>): number | null => {
    const vals = ['blog_rank_tab', 'blog_rank_general', 'blog_rank_integrated', 'blog_rank_pet_popular']
      .map((k) => num(r[k]))
      .filter((x): x is number => x != null);
    return vals.length ? Math.min(...vals) : null;
  };

  const collect = (
    rows: Record<string, unknown>[],
    pick: (r: Record<string, unknown>) => number | null,
  ) => {
    // (병원, 키워드)별로 최신 값과 4주 전(그 이전 중 가장 가까운) 값을 찾는다.
    type Slot = { latestDate: string; latest: number | null; baseDate: string | null; base: number | null };
    const byKey = new Map<string, Slot>();
    for (const r of rows) {
      const hid = String(r.hospital_id ?? '');
      const kw = String(r.keyword ?? '').trim();
      if (!hid || !kw) continue;
      const dk = dateKeyOf(r.metric_date);
      const val = pick(r);
      const key = `${hid} ${kw}`;
      const slot = byKey.get(key) ?? { latestDate: '', latest: null, baseDate: null, base: null };
      if (dk > slot.latestDate) { slot.latestDate = dk; slot.latest = val; }
      if (dk <= target && (slot.baseDate == null || dk > slot.baseDate)) { slot.baseDate = dk; slot.base = val; }
      byKey.set(key, slot);
    }
    for (const [key, slot] of byKey) {
      const hid = key.split(' ')[0];
      // 순위는 숫자가 작을수록 좋다. 떨어졌다 = 숫자가 커졌다 or 노출이 사라졌다(base 있었는데 latest 없음).
      if (slot.base == null) continue;
      if (slot.latest == null || slot.latest > slot.base) bump(hid);
    }
  };

  collect(blogRows, best);
  collect(placeRows, (r) => num(r.rank_value));
  return drops;
}
