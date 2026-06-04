import { createClient } from "@/lib/supabase/client";
import type { KeywordPerf } from "@/lib/searchad-aggregates";

export type HospitalOption = {
  hospital_id: string;
  hospital_name: string;
  naver_blog_id: string | null;
  address: string | null;
};

export type KeywordTargetRow = {
  id: number;
  account_id: string;
  hospital_id: string | null;
  keyword: string;
  is_active: boolean;
  source: string;
  metadata?: unknown | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type HospitalScope = {
  isAdmin: boolean;
  hospitals: HospitalOption[];
  /** core.users.name */
  userName: string | null;
  /** core.users.hospital_id (text, snake_case) */
  assignedHospitalId: string | null;
};

export type SummaryKpis = {
  salesCurrentWeek: (number | null)[];
  salesPreviousWeek: (number | null)[];
  newCustomersCurrentWeek: (number | null)[];
  newCustomersPreviousWeek: (number | null)[];
  datePairs: { currentDate: string; previousDate: string }[];
};

/** 일별 KPI 시계열 (경영 통계 페이지). dateKey는 Asia/Seoul 기준 YYYY-MM-DD. */
export type HospitalManagementDayRow = {
  dateKey: string;
  periodType: "day" | "month" | "year";
  sales: number | null;
  visits: number | null;
  newPatients: number | null;
};

export type BlogRankSummaryRow = {
  keyword: string;
  blog_rank_tab: number | null;
  blog_rank_general: number | null;
  blog_rank_integrated: number | null;
  blog_rank_pet_popular: number | null;
  blog_rank_tab_trend: -1 | 0 | 1;
  blog_rank_general_trend: -1 | 0 | 1;
  blog_rank_integrated_trend: -1 | 0 | 1;
  blog_rank_pet_popular_trend: -1 | 0 | 1;
  blog_rank_tab_url: string | null;
  blog_rank_general_url: string | null;
  blog_rank_integrated_url: string | null;
  blog_rank_pet_popular_url: string | null;
  /** 가장 최근 수집일 (Asia/Seoul YYYY-MM-DD). 모든 row 동일 값. */
  latestDateKey: string | null;
  /** 화살표 비교 기준이 된 수집일(약 14일 전, 폴백 적용 후). 모든 row 동일 값. */
  baselineDateKey: string | null;
};

/** 블로그 KPI 시계열 (analytics.chart_blog_period_view). dateKey는 Asia/Seoul 기준 YYYY-MM-DD. */
export type BlogPeriodDayRow = {
  dateKey: string;
  periodType: "day" | "month" | "year";
  views: number | null;
  uniqueVisitors: number | null;
};

export type BlogRankTrendPoint = {
  dateKey: string;
  blog_rank_tab: number | null;
  blog_rank_general: number | null;
  blog_rank_integrated: number | null;
  blog_rank_pet_popular: number | null;
};

export type PlaceRankSummaryRow = {
  keyword: string;
  rank_value: number | null;
  /** 14일 전(폴백 적용) 대비 순위 변동. 1=상승(숫자↓), -1=하락, 0=동일/비교불가 */
  rank_value_trend: -1 | 0 | 1;
  /** 가장 최근 수집일 (Asia/Seoul YYYY-MM-DD). 모든 row 동일 값. */
  latestDateKey: string | null;
  /** 화살표 비교 기준이 된 수집일(약 14일 전, 폴백 적용 후). 모든 row 동일 값. */
  baselineDateKey: string | null;
};

/** 플레이스 리뷰 통계 (최근 6개월) — analytics.analytics_place_reviews 집계. */
export type PlaceReviewStats = {
  /** 최근 6개월 월별 리뷰 수 (오래된→최신, 6개) */
  monthly: { monthKey: string; monthLabel: string; count: number }[];
  /** 5단계 감성 분포 카운트 */
  strongPositiveCount: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
  strongNegativeCount: number;
  /** 최근 6개월 부정 리뷰 목록 (강한 부정 먼저). strong=강한 부정 */
  negativeReviews: {
    reviewDate: string;
    authorId: string | null;
    content: string | null;
    strong: boolean;
  }[];
};

/** 플레이스 KPI 시계열 (analytics.chart_place_period_view). */
export type PlacePeriodDayRow = {
  dateKey: string;
  periodType: "day" | "month" | "year";
  inflow: number | null;
};

/** 네이버 검색광고 일별 성과 (analytics.analytics_searchad_daily_metrics).
 *  campaign/adgroup/keyword 레벨이 ID 채움 패턴으로 구분돼 한 테이블에 섞여 있음. */
export type SearchAdRow = {
  dateKey: string;
  campaignId: string;
  campaignName: string | null;
  campaignType: string | null;
  adgroupId: string;
  adgroupName: string | null;
  keywordId: string;
  keywordName: string | null;
  impressions: number;
  clicks: number;
  cost: number;
};

/** 오늘 날짜 (Asia/Seoul 달력 기준 YYYY-MM-DD) */
function todayDateKeySeoul(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
}

function addCalendarDaysUtc(dateKey: string, delta: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + delta * 86400000;
  const dt = new Date(t);
  const ys = dt.getUTCFullYear();
  const mo = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const da = String(dt.getUTCDate()).padStart(2, "0");
  return `${ys}-${mo}-${da}`;
}

function asNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const normalized = value.replace(/,/g, "").trim();
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function firstNumber(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    if (!(key in row)) continue;
    const n = asNumberOrNull(row[key]);
    if (n != null) return n;
  }
  return null;
}

function asStringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function toSeoulDateKey(d: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(d);
}

/**
 * PostgREST 1000행 cap 우회용 페이지네이션 헬퍼. 빈 응답 받을 때까지 받아옴.
 * buildPage 는 (from, to) inclusive range 받아 supabase select 호출 반환.
 */
async function fetchAllPages<T = Record<string, unknown>>(
  buildPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  let received = 0;
  for (let iter = 0; iter < 50; iter++) {
    const { data, error } = await buildPage(received, received + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    received += data.length;
  }
  return out;
}

function parseDateValue(row: Record<string, unknown>): Date | null {
  const candidates = [
    row.metric_date,
    row.business_date,
    row.period_start_date,
    row.period_date,
    row.period_start,
    row.period,
    row.ym,
    row.start_date,
    row.target_date,
    row.day,
    row.month,
    row.year,
    row.base_date,
    row.collected_at,
    row.date,
  ];
  for (const value of candidates) {
    if (value == null) continue;
    const date = new Date(String(value));
    if (!Number.isNaN(date.getTime())) return date;
  }

  for (const [key, value] of Object.entries(row)) {
    if (value == null) continue;
    if (!/(date|day|period|month|year)/i.test(key)) continue;
    const date = new Date(String(value));
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

function latestSnapshotRows<T extends Record<string, unknown>>(rows: T[]): T[] {
  if (rows.length === 0) return [];
  const stamped = rows
    .map((row) => ({ row, date: parseDateValue(row) }))
    .filter((item): item is { row: T; date: Date } => item.date !== null);
  if (stamped.length === 0) return rows;

  const maxTime = Math.max(...stamped.map((item) => item.date.getTime()));
  return stamped
    .filter((item) => item.date.getTime() === maxTime)
    .map((item) => item.row);
}

function userNameFromProfile(profile: { name?: unknown } | null | undefined): string | null {
  const n = profile?.name;
  return typeof n === "string" && n.trim() !== "" ? n.trim() : null;
}

export async function fetchHospitalScope(): Promise<HospitalScope> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { isAdmin: false, hospitals: [], userName: null, assignedHospitalId: null };
  }

  const { data: profile, error: profileError } = await supabase
    .schema("core")
    .from("users")
    .select("id,hospital_id,name")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) throw profileError;

  const userName = userNameFromProfile(profile);
  const assignedHospitalId =
    profile?.hospital_id != null ? String(profile.hospital_id) : null;

  if (!profile?.hospital_id) {
    return { isAdmin: false, hospitals: [], userName, assignedHospitalId };
  }

  const { data: hospitals, error: hospitalError } = await supabase
    .schema("core")
    .from("hospitals")
    .select("id,name,naver_blog_id,address")
    .eq("id", profile.hospital_id)
    .order("name", { ascending: true });
  if (hospitalError) throw hospitalError;

  return {
    isAdmin: false,
    hospitals: (hospitals ?? []).map((row) => ({
      hospital_id: String(row.id),
      hospital_name: row.name ?? String(row.id),
      naver_blog_id: row.naver_blog_id != null ? String(row.naver_blog_id) : null,
      address:
        row.address != null && String(row.address).trim() !== ""
          ? String(row.address).trim()
          : null,
    })),
    userName,
    assignedHospitalId,
  };
}

export async function fetchSummaryKpis(hospitalId: string): Promise<SummaryKpis> {
  const supabase = createClient();

  const rawRows = await fetchAllPages((from, to) =>
    supabase
      .schema("analytics")
      .from("chart_kpis_period_view")
      .select("*")
      .eq("hospital_id", hospitalId)
      .eq("period_type", "day")
      .order("period_start_date", { ascending: true })
      .range(from, to),
  );
  const hasIntovet = rawRows.some((r) => String(r.chart_type ?? "").toLowerCase() === "intovet");
  const sourceRows = hasIntovet
    ? rawRows.filter((r) => String(r.chart_type ?? "").toLowerCase() === "intovet")
    : rawRows;

  const byDate = new Map<string, { sales: number | null; patients: number | null }>();
  for (const rawRow of sourceRows) {
    const parsedDate = parseDateValue(rawRow);
    if (!parsedDate) continue;
    const dateKey = toSeoulDateKey(parsedDate);
    byDate.set(dateKey, {
      sales: firstNumber(rawRow, ["sales_amount", "monthly_sales", "sales"]),
      patients: firstNumber(rawRow, [
        "new_customer_count",
        "visit_count",
        "patient_count",
        "customers",
      ]),
    });
  }

  const latestDate =
    Array.from(byDate.keys()).sort().at(-1) ??
    addCalendarDaysUtc(todayDateKeySeoul(), -1);
  const endDate = latestDate;
  const currentDates = Array.from({ length: 7 }, (_, i) => addCalendarDaysUtc(endDate, -6 + i));
  const previousDates = currentDates.map((d) => addCalendarDaysUtc(d, -7));
  const datePairs = currentDates.map((currentDate, i) => ({
    currentDate,
    previousDate: previousDates[i],
  }));

  const toWeek = (
    weekDates: string[],
    key: "sales" | "patients"
  ): (number | null)[] => weekDates.map((d) => byDate.get(d)?.[key] ?? null);

  return {
    salesCurrentWeek: toWeek(currentDates, "sales"),
    salesPreviousWeek: toWeek(previousDates, "sales"),
    newCustomersCurrentWeek: toWeek(currentDates, "patients"),
    newCustomersPreviousWeek: toWeek(previousDates, "patients"),
    datePairs,
  };
}

export async function fetchHospitalManagementKpis(
  hospitalId: string
): Promise<HospitalManagementDayRow[]> {
  const supabase = createClient();

  const fetchKpisPeriod = (periodType: "day" | "month" | "year") =>
    fetchAllPages((from, to) =>
      supabase
        .schema("analytics")
        .from("chart_kpis_period_view")
        .select("*")
        .eq("hospital_id", hospitalId)
        .eq("period_type", periodType)
        .order("period_start_date", { ascending: true })
        .range(from, to),
    );
  const [dayK, monthK, yearK] = await Promise.all([
    fetchKpisPeriod("day"),
    fetchKpisPeriod("month"),
    fetchKpisPeriod("year"),
  ]);
  const rawRows: Record<string, unknown>[] = [...dayK, ...monthK, ...yearK];

  const hasIntovet = rawRows.some((r) => String(r.chart_type ?? "").toLowerCase() === "intovet");
  const sourceRows = hasIntovet
    ? rawRows.filter((r) => String(r.chart_type ?? "").toLowerCase() === "intovet")
    : rawRows;

  const mapped = sourceRows
    .map((rawRow) => {
      const parsedDate = parseDateValue(rawRow);
      if (!parsedDate) return null;
      const periodType = String(rawRow.period_type ?? "").toLowerCase();
      if (periodType !== "day" && periodType !== "month" && periodType !== "year") return null;
      return {
        dateKey: toSeoulDateKey(parsedDate),
        periodType,
        sales: firstNumber(rawRow, ["sales_amount", "monthly_sales", "sales"]),
        visits: firstNumber(rawRow, ["visit_count", "treatment_count", "patient_count", "visits"]),
        newPatients: firstNumber(rawRow, [
          "new_customer_count",
          "new_patient_count",
          "new_patients",
        ]),
      } as HospitalManagementDayRow;
    })
    .filter((row): row is HospitalManagementDayRow => row !== null);

  const dedup = new Map<string, HospitalManagementDayRow>();
  for (const row of mapped) {
    dedup.set(`${row.periodType}:${row.dateKey}`, row);
  }

  return Array.from(dedup.values()).sort((a, b) => {
    if (a.periodType === b.periodType) return a.dateKey.localeCompare(b.dateKey);
    return a.periodType.localeCompare(b.periodType);
  });
}

export async function fetchBlogPeriodKpis(hospitalId: string): Promise<BlogPeriodDayRow[]> {
  const supabase = createClient();

  const fetchBlogPeriod = (periodType: "day" | "month" | "year") =>
    fetchAllPages((from, to) =>
      supabase
        .schema("analytics")
        .from("chart_blog_period_view")
        .select("*")
        .eq("hospital_id", hospitalId)
        .eq("period_type", periodType)
        .order("metric_date", { ascending: true })
        .range(from, to),
    );
  const [dayRows, monthRows, yearRows] = await Promise.all([
    fetchBlogPeriod("day"),
    fetchBlogPeriod("month"),
    fetchBlogPeriod("year"),
  ]);
  const rawRows: Record<string, unknown>[] = [...dayRows, ...monthRows, ...yearRows];

  const mapped = rawRows
    .map((rawRow) => {
      const parsedDate = parseDateValue(rawRow);
      if (!parsedDate) return null;
      const periodType = String(rawRow.period_type ?? "").toLowerCase();
      if (periodType !== "day" && periodType !== "month" && periodType !== "year") return null;
      return {
        dateKey: toSeoulDateKey(parsedDate),
        periodType,
        views: firstNumber(rawRow, ["blog_views", "views"]),
        uniqueVisitors: firstNumber(rawRow, ["blog_unique_visitors", "unique_visitors"]),
      } as BlogPeriodDayRow;
    })
    .filter((row): row is BlogPeriodDayRow => row !== null);

  const dedup = new Map<string, BlogPeriodDayRow>();
  for (const row of mapped) {
    dedup.set(`${row.periodType}:${row.dateKey}`, row);
  }

  return Array.from(dedup.values()).sort((a, b) => {
    if (a.periodType === b.periodType) return a.dateKey.localeCompare(b.dateKey);
    return a.periodType.localeCompare(b.periodType);
  });
}

export async function fetchSummaryBlogRanks(hospitalId: string): Promise<BlogRankSummaryRow[]> {
  const supabase = createClient();
  const rows = await fetchAllPages((from, to) =>
    supabase
      .schema("analytics")
      .from("analytics_blog_keyword_ranks_daily_view")
      .select("*")
      .eq("hospital_id", hospitalId)
      .order("metric_date", { ascending: true })
      .range(from, to),
  );
  const stamped = rows
    .map((row) => {
      const date = parseDateValue(row);
      if (!date) return null;
      return { row, dateKey: toSeoulDateKey(date) };
    })
    .filter(
      (item): item is { row: Record<string, unknown>; dateKey: string } => item !== null
    );

  const toTrend = (current: number | null, previous: number | null): -1 | 0 | 1 => {
    if (current == null || previous == null) return 0;
    if (current < previous) return 1;
    if (current > previous) return -1;
    return 0;
  };

  type RankKeywordSnapshot = {
    keyword: string;
    blog_rank_tab: number | null;
    blog_rank_general: number | null;
    blog_rank_integrated: number | null;
    blog_rank_pet_popular: number | null;
    blog_rank_tab_url: string | null;
    blog_rank_general_url: string | null;
    blog_rank_integrated_url: string | null;
    blog_rank_pet_popular_url: string | null;
  };

  const mergeRowsByKeyword = (input: Record<string, unknown>[]) => {
    const byKeyword = new Map<string, RankKeywordSnapshot>();
    for (const row of input) {
      const keyword = asStringOrNull(row.keyword) ?? "-";
      const prev = byKeyword.get(keyword) ?? {
        keyword,
        blog_rank_tab: null,
        blog_rank_general: null,
        blog_rank_integrated: null,
        blog_rank_pet_popular: null,
        blog_rank_tab_url: null,
        blog_rank_general_url: null,
        blog_rank_integrated_url: null,
        blog_rank_pet_popular_url: null,
      };
      byKeyword.set(keyword, {
        keyword,
        blog_rank_tab: asNumberOrNull(row.blog_rank_tab) ?? prev.blog_rank_tab,
        blog_rank_general: asNumberOrNull(row.blog_rank_general) ?? prev.blog_rank_general,
        blog_rank_integrated:
          asNumberOrNull(row.blog_rank_integrated) ?? prev.blog_rank_integrated,
        blog_rank_pet_popular:
          asNumberOrNull(row.blog_rank_pet_popular) ?? prev.blog_rank_pet_popular,
        blog_rank_tab_url: asStringOrNull(row.blog_rank_tab_url) ?? prev.blog_rank_tab_url,
        blog_rank_general_url:
          asStringOrNull(row.blog_rank_general_url) ?? prev.blog_rank_general_url,
        blog_rank_integrated_url:
          asStringOrNull(row.blog_rank_integrated_url) ?? prev.blog_rank_integrated_url,
        blog_rank_pet_popular_url:
          asStringOrNull(row.blog_rank_popular_url) ??
          asStringOrNull(row.blog_rank_pet_popular_url) ??
          prev.blog_rank_pet_popular_url,
      });
    }
    return byKeyword;
  };

  if (stamped.length === 0) {
    return latestSnapshotRows(rows)
      .map((row) => ({
        keyword: asStringOrNull(row.keyword) ?? "-",
        blog_rank_tab: asNumberOrNull(row.blog_rank_tab),
        blog_rank_general: asNumberOrNull(row.blog_rank_general),
        blog_rank_integrated: asNumberOrNull(row.blog_rank_integrated),
        blog_rank_pet_popular: asNumberOrNull(row.blog_rank_pet_popular),
        blog_rank_tab_trend: 0 as const,
        blog_rank_general_trend: 0 as const,
        blog_rank_integrated_trend: 0 as const,
        blog_rank_pet_popular_trend: 0 as const,
        blog_rank_tab_url: asStringOrNull(row.blog_rank_tab_url),
        blog_rank_general_url: asStringOrNull(row.blog_rank_general_url),
        blog_rank_integrated_url: asStringOrNull(row.blog_rank_integrated_url),
        blog_rank_pet_popular_url:
          asStringOrNull(row.blog_rank_popular_url) ??
          asStringOrNull(row.blog_rank_pet_popular_url),
        latestDateKey: null,
        baselineDateKey: null,
      }))
      .sort((a, b) => a.keyword.localeCompare(b.keyword, "ko"));
  }

  const dateKeys = Array.from(new Set(stamped.map((item) => item.dateKey))).sort();
  const dateKeySet = new Set(dateKeys);
  const latestDateKey = dateKeys.at(-1) as string;
  // 화살표 비교 기준: 정확히 14일 전. 그 날짜에 수집이 없으면 아래 우선순위로 폴백.
  const BASELINE_OFFSET_PRIORITY = [14, 15, 13, 16, 12, 17, 11, 18, 10, 19, 20];
  const baselineDateKey =
    BASELINE_OFFSET_PRIORITY.map((offset) => addCalendarDaysUtc(latestDateKey, -offset)).find(
      (key) => dateKeySet.has(key),
    ) ?? null;

  const latestRows = stamped
    .filter((item) => item.dateKey === latestDateKey)
    .map((item) => item.row);
  const latestByKeyword = mergeRowsByKeyword(latestRows);
  const baselineByKeyword = baselineDateKey
    ? mergeRowsByKeyword(
        stamped.filter((item) => item.dateKey === baselineDateKey).map((item) => item.row)
      )
    : new Map<string, RankKeywordSnapshot>();

  return Array.from(latestByKeyword.values())
    .map((current) => {
      const previous = baselineByKeyword.get(current.keyword) ?? null;
      return {
        ...current,
        blog_rank_tab_trend: toTrend(current.blog_rank_tab, previous?.blog_rank_tab ?? null),
        blog_rank_general_trend: toTrend(
          current.blog_rank_general,
          previous?.blog_rank_general ?? null
        ),
        blog_rank_integrated_trend: toTrend(
          current.blog_rank_integrated,
          previous?.blog_rank_integrated ?? null
        ),
        blog_rank_pet_popular_trend: toTrend(
          current.blog_rank_pet_popular,
          previous?.blog_rank_pet_popular ?? null
        ),
        latestDateKey,
        baselineDateKey,
      } as BlogRankSummaryRow;
    })
    .sort((a, b) => a.keyword.localeCompare(b.keyword, "ko"));
}

export async function fetchBlogKeywordRankTrend(
  hospitalId: string,
  keyword: string
): Promise<BlogRankTrendPoint[]> {
  const supabase = createClient();
  const data = await fetchAllPages((from, to) =>
    supabase
      .schema("analytics")
      .from("analytics_blog_keyword_ranks_daily_view")
      .select("*")
      .eq("hospital_id", hospitalId)
      .eq("keyword", keyword)
      .order("metric_date", { ascending: true })
      .range(from, to),
  );

  const stamped = data
    .map((row) => {
      const date = parseDateValue(row);
      if (!date) return null;
      return { row, dateKey: toSeoulDateKey(date) };
    })
    .filter(
      (item): item is { row: Record<string, unknown>; dateKey: string } => item !== null
    );
  if (stamped.length === 0) return [];

  const latestDateKey = stamped
    .map((item) => item.dateKey)
    .sort()
    .at(-1) as string;
  const startDateKey = addCalendarDaysUtc(latestDateKey, -183);

  const byDate = new Map<string, BlogRankTrendPoint>();
  for (const item of stamped) {
    if (item.dateKey < startDateKey) continue;
    const prev = byDate.get(item.dateKey) ?? {
      dateKey: item.dateKey,
      blog_rank_tab: null,
      blog_rank_general: null,
      blog_rank_integrated: null,
      blog_rank_pet_popular: null,
    };
    byDate.set(item.dateKey, {
      dateKey: item.dateKey,
      blog_rank_tab: asNumberOrNull(item.row.blog_rank_tab) ?? prev.blog_rank_tab,
      blog_rank_general:
        asNumberOrNull(item.row.blog_rank_general) ?? prev.blog_rank_general,
      blog_rank_integrated:
        asNumberOrNull(item.row.blog_rank_integrated) ?? prev.blog_rank_integrated,
      blog_rank_pet_popular:
        asNumberOrNull(item.row.blog_rank_pet_popular) ?? prev.blog_rank_pet_popular,
    });
  }

  return Array.from(byDate.values()).sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

/** 순위 화살표 비교 기준: 정확히 14일 전, 없으면 아래 우선순위로 폴백(블로그·플레이스 공통). */
const RANK_BASELINE_OFFSET_PRIORITY = [14, 15, 13, 16, 12, 17, 11, 18, 10, 19, 20];
function pickBaselineDateKey(latestDateKey: string, dateKeySet: Set<string>): string | null {
  return (
    RANK_BASELINE_OFFSET_PRIORITY.map((offset) => addCalendarDaysUtc(latestDateKey, -offset)).find(
      (key) => dateKeySet.has(key),
    ) ?? null
  );
}
/** 순위(작을수록 좋음) 변동. 1=상승(현재가 더 작음), -1=하락, 0=동일/비교불가 */
function rankTrend(current: number | null, previous: number | null): -1 | 0 | 1 {
  if (current == null || previous == null) return 0;
  if (current < previous) return 1;
  if (current > previous) return -1;
  return 0;
}

export async function fetchSummaryPlaceRanks(
  hospitalId: string
): Promise<PlaceRankSummaryRow[]> {
  const supabase = createClient();
  const data = await fetchAllPages((from, to) =>
    supabase
      .schema("analytics")
      .from("analytics_place_keyword_ranks")
      .select("*")
      .eq("hospital_id", hospitalId)
      .order("metric_date", { ascending: true })
      .range(from, to),
  );

  const stamped = data
    .map((row) => {
      const date = parseDateValue(row);
      if (!date) return null;
      return { row, dateKey: toSeoulDateKey(date) };
    })
    .filter(
      (item): item is { row: Record<string, unknown>; dateKey: string } => item !== null
    );

  if (stamped.length === 0) {
    return latestSnapshotRows(data)
      .map((row) => ({
        keyword: asStringOrNull(row.keyword) ?? "-",
        rank_value: asNumberOrNull(row.rank_value),
        rank_value_trend: 0 as const,
        latestDateKey: null,
        baselineDateKey: null,
      }))
      .sort((a, b) => a.keyword.localeCompare(b.keyword, "ko"));
  }

  const dateKeys = Array.from(new Set(stamped.map((item) => item.dateKey))).sort();
  const dateKeySet = new Set(dateKeys);
  const latestDateKey = dateKeys.at(-1) as string;
  const baselineDateKey = pickBaselineDateKey(latestDateKey, dateKeySet);

  // 특정 수집일의 keyword→rank_value 맵 (같은 날 중복 행은 마지막 non-null 유지)
  const snapshotByKeyword = (dk: string) => {
    const map = new Map<string, number | null>();
    for (const item of stamped) {
      if (item.dateKey !== dk) continue;
      const keyword = asStringOrNull(item.row.keyword) ?? "-";
      const rv = asNumberOrNull(item.row.rank_value);
      map.set(keyword, rv ?? map.get(keyword) ?? null);
    }
    return map;
  };

  const latestMap = snapshotByKeyword(latestDateKey);
  const baselineMap = baselineDateKey
    ? snapshotByKeyword(baselineDateKey)
    : new Map<string, number | null>();

  return Array.from(latestMap.entries())
    .map(([keyword, rank_value]) => ({
      keyword,
      rank_value,
      rank_value_trend: rankTrend(rank_value, baselineMap.get(keyword) ?? null),
      latestDateKey,
      baselineDateKey,
    }))
    .sort((a, b) => a.keyword.localeCompare(b.keyword, "ko"));
}

export async function fetchPlaceReviewStats(
  hospitalId: string
): Promise<PlaceReviewStats> {
  // 최근 6개월 월 버킷(현재월 포함, 오래된→최신)
  const todayKey = todayDateKeySeoul();
  const [ty, tm] = todayKey.split("-").map(Number);
  const monthly: PlaceReviewStats["monthly"] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(ty, tm - 1 - i, 1));
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    monthly.push({ monthKey: `${y}-${String(m).padStart(2, "0")}`, monthLabel: `${m}월`, count: 0 });
  }
  const startDate = `${monthly[0]!.monthKey}-01`; // 추이(차트): 최근 12개월
  const sentimentStart = `${monthly[6]!.monthKey}-01`; // 긍정/부정 집계: 최근 6개월
  const empty: PlaceReviewStats = {
    monthly,
    strongPositiveCount: 0,
    positiveCount: 0,
    neutralCount: 0,
    negativeCount: 0,
    strongNegativeCount: 0,
    negativeReviews: [],
  };

  try {
    const supabase = createClient();
    const rows = await fetchAllPages((from, to) =>
      supabase
        .schema("analytics")
        .from("analytics_place_reviews")
        // UI 는 방문일(visit_date) 기준. 예전 행(visit_date null) 대비 review_date 도 폴백으로 함께 조회.
        .select("visit_date, review_date, author_id, content, sentiment")
        .eq("hospital_id", hospitalId)
        .gte("visit_date", startDate)
        .order("visit_date", { ascending: false })
        .range(from, to),
    );

    const monthIndex = new Map(monthly.map((m, i) => [m.monthKey, i] as const));
    let strongPositiveCount = 0;
    let positiveCount = 0;
    let neutralCount = 0;
    let negativeCount = 0;
    let strongNegativeCount = 0;
    const negativeReviews: PlaceReviewStats["negativeReviews"] = [];

    for (const row of rows) {
      const dateKey = asStringOrNull(row.visit_date) ?? asStringOrNull(row.review_date);
      const sentiment = asStringOrNull(row.sentiment);
      if (dateKey) {
        const idx = monthIndex.get(dateKey.slice(0, 7));
        if (idx != null) monthly[idx]!.count += 1;
      }
      // 긍정/부정 집계·부정 목록은 최근 6개월만 (추이 차트만 12개월)
      if (!dateKey || dateKey < sentimentStart) continue;
      if (sentiment === "strong_positive") strongPositiveCount += 1;
      else if (sentiment === "positive") positiveCount += 1;
      else if (sentiment === "neutral") neutralCount += 1;
      else if (sentiment === "negative" || sentiment === "strong_negative") {
        const strong = sentiment === "strong_negative";
        if (strong) strongNegativeCount += 1;
        else negativeCount += 1;
        negativeReviews.push({
          reviewDate: dateKey ?? "",
          authorId: asStringOrNull(row.author_id),
          content: asStringOrNull(row.content),
          strong,
        });
      }
    }

    // 강한 부정을 먼저(목록 상단). 같은 그룹 내에서는 방문일 최신순(쿼리 정렬) 유지.
    negativeReviews.sort((a, b) => (b.strong ? 1 : 0) - (a.strong ? 1 : 0));

    return {
      monthly,
      strongPositiveCount,
      positiveCount,
      neutralCount,
      negativeCount,
      strongNegativeCount,
      negativeReviews,
    };
  } catch {
    // 테이블 미생성/권한 등 — 빈 통계로 폴백(다른 위젯은 정상 동작).
    return empty;
  }
}

/** 병원별 등록된 경쟁 병원(최대 3). */
export type HospitalCompetitor = { slot: number; name: string; naverBlogId: string | null };

export async function fetchCompetitors(hospitalId: string): Promise<HospitalCompetitor[]> {
  try {
    const supabase = createClient();
    const { data } = await supabase
      .schema("analytics")
      .from("analytics_hospital_competitors")
      .select("slot, name, naver_blog_id")
      .eq("hospital_id", hospitalId)
      .eq("is_active", true)
      .order("slot", { ascending: true });
    return (data ?? []).map((r) => ({
      slot: Number((r as { slot?: number }).slot) || 0,
      name: String((r as { name?: string }).name || ""),
      naverBlogId: asStringOrNull((r as { naver_blog_id?: unknown }).naver_blog_id),
    }));
  } catch {
    return [];
  }
}

/** 경쟁사 순위(최신 수집 기준). channel별·slot별·키워드별 순위. */
export type CompetitorRank = {
  channel: "blog" | "place";
  slot: number;
  keyword: string;
  rank: number | null;
};

export async function fetchCompetitorRanks(hospitalId: string): Promise<CompetitorRank[]> {
  try {
    const supabase = createClient();
    const { data } = await supabase
      .schema("analytics")
      .from("analytics_competitor_ranks")
      .select("channel, slot, keyword, rank_value, metric_date")
      .eq("hospital_id", hospitalId)
      .order("metric_date", { ascending: false });
    const seen = new Set<string>();
    const out: CompetitorRank[] = [];
    for (const r of data ?? []) {
      const channel = String((r as { channel?: string }).channel || "");
      const slot = Number((r as { slot?: number }).slot) || 0;
      const keyword = String((r as { keyword?: string }).keyword || "");
      if (channel !== "blog" && channel !== "place") continue;
      const key = `${channel}|${slot}|${keyword}`;
      if (seen.has(key)) continue; // metric_date desc 정렬이므로 최신만 유지
      seen.add(key);
      out.push({ channel, slot, keyword, rank: asNumberOrNull((r as { rank_value?: unknown }).rank_value) });
    }
    return out;
  } catch {
    return [];
  }
}

export async function fetchPlacePeriodKpis(
  hospitalId: string
): Promise<PlacePeriodDayRow[]> {
  const supabase = createClient();
  const fetchPlacePeriod = (periodType: "day" | "month" | "year") =>
    fetchAllPages((from, to) =>
      supabase
        .schema("analytics")
        .from("chart_place_period_view")
        .select("*")
        .eq("hospital_id", hospitalId)
        .eq("period_type", periodType)
        .order("period_date", { ascending: true })
        .range(from, to),
    );
  const [dayPlace, monthPlace, yearPlace] = await Promise.all([
    fetchPlacePeriod("day"),
    fetchPlacePeriod("month"),
    fetchPlacePeriod("year"),
  ]);
  const viewRows: Record<string, unknown>[] = [...dayPlace, ...monthPlace, ...yearPlace];

  const mapped = viewRows
    .map((rawRow) => {
      const parsedDate = parseDateValue(rawRow);
      if (!parsedDate) return null;
      const periodType = String(rawRow.period_type ?? "").toLowerCase();
      if (periodType !== "day" && periodType !== "month" && periodType !== "year") return null;
      return {
        dateKey: toSeoulDateKey(parsedDate),
        periodType,
        inflow: firstNumber(rawRow, ["smartplace_inflow", "place_inflow", "inflow"]),
      } as PlacePeriodDayRow;
    })
    .filter((row): row is PlacePeriodDayRow => row !== null);

  const dedup = new Map<string, PlacePeriodDayRow>();
  for (const row of mapped) {
    dedup.set(`${row.periodType}:${row.dateKey}`, row);
  }

  const fromView = Array.from(dedup.values()).sort((a, b) => {
    if (a.periodType === b.periodType) return a.dateKey.localeCompare(b.dateKey);
    return a.periodType.localeCompare(b.periodType);
  });
  if (fromView.length > 0) return fromView;

  // Fallback: view가 비어 있으면 원본 일별 테이블을 직접 집계한다.
  const rawData = await fetchAllPages((from, to) =>
    supabase
      .schema("analytics")
      .from("analytics_smartplace_daily_metrics")
      .select("hospital_id,metric_date,smartplace_inflow")
      .eq("hospital_id", hospitalId)
      .order("metric_date", { ascending: true })
      .range(from, to),
  );

  const dayMap = new Map<string, number>();
  const monthMap = new Map<string, number>();
  const yearMap = new Map<string, number>();

  for (const row of rawData) {
    const date = parseDateValue(row);
    if (!date) continue;
    const dateKey = toSeoulDateKey(date);
    const value = asNumberOrNull(row.smartplace_inflow) ?? 0;
    dayMap.set(dateKey, (dayMap.get(dateKey) ?? 0) + value);
    const ym = dateKey.slice(0, 7);
    monthMap.set(ym, (monthMap.get(ym) ?? 0) + value);
    const y = dateKey.slice(0, 4);
    yearMap.set(y, (yearMap.get(y) ?? 0) + value);
  }

  const fallbackRows: PlacePeriodDayRow[] = [];
  for (const [dateKey, inflow] of dayMap.entries()) {
    fallbackRows.push({ dateKey, periodType: "day", inflow });
  }
  for (const [ym, inflow] of monthMap.entries()) {
    fallbackRows.push({ dateKey: `${ym}-01`, periodType: "month", inflow });
  }
  for (const [y, inflow] of yearMap.entries()) {
    fallbackRows.push({ dateKey: `${y}-01-01`, periodType: "year", inflow });
  }

  return fallbackRows.sort((a, b) => {
    if (a.periodType === b.periodType) return a.dateKey.localeCompare(b.dateKey);
    return a.periodType.localeCompare(b.periodType);
  });
}

const SEARCHAD_SELECT =
  "metric_date,campaign_id,campaign_name,campaign_type,adgroup_id,adgroup_name,keyword_id,keyword_name,impressions,clicks,cost";

// 모든 병원·양쪽 탭(파워링크/플레이스) 공통 검색광고 노출 하한.
// "180일"이 아니라 **현재 달에서 6개월 전인 달의 1일**부터 보여준다(달 경계가 깔끔).
// 예: 오늘 2026-06-03 → 2025-12-01 (= 최소 6개월 + 이번 달 일수만큼).
export function searchAdSinceDate(): string {
  const [y, m] = todayDateKeySeoul().split("-").map(Number);
  const monthsZeroBased = y * 12 + (m - 1) - 6; // 6개월 전 달
  const ty = Math.floor(monthsZeroBased / 12);
  const tm = (monthsZeroBased % 12) + 1;
  return `${ty}-${String(tm).padStart(2, "0")}-01`;
}

function mapSearchAdRow(r: Record<string, unknown>): SearchAdRow {
  return {
    dateKey: String(r.metric_date ?? "").slice(0, 10),
    campaignId: asStringOrNull(r.campaign_id) ?? "",
    campaignName: asStringOrNull(r.campaign_name),
    campaignType: asStringOrNull(r.campaign_type),
    adgroupId: asStringOrNull(r.adgroup_id) ?? "",
    adgroupName: asStringOrNull(r.adgroup_name),
    keywordId: asStringOrNull(r.keyword_id) ?? "",
    keywordName: asStringOrNull(r.keyword_name),
    impressions: asNumberOrNull(r.impressions) ?? 0,
    clicks: asNumberOrNull(r.clicks) ?? 0,
    cost: asNumberOrNull(r.cost) ?? 0,
  };
}

/**
 * 메인 뷰(추세·KPI·캠페인표)용 — **캠페인·광고그룹 레벨만(keyword_id='')**, **최근 6개월만** 가져온다.
 * 여기서 정해진 날짜 경계가 화면 선택기와 Top키워드 조회 범위를 6개월로 묶는다.
 */
export async function fetchSearchAdMetrics(
  hospitalId: string,
  campaignType?: string,
): Promise<SearchAdRow[]> {
  const supabase = createClient();
  const since = searchAdSinceDate();
  const rows = await fetchAllPages((from, to) => {
    let q = supabase
      .schema("analytics")
      .from("analytics_searchad_daily_metrics")
      .select(SEARCHAD_SELECT)
      .eq("hospital_id", hospitalId)
      .eq("keyword_id", "")
      .gte("metric_date", since);
    if (campaignType) q = q.eq("campaign_type", campaignType);
    return q.order("metric_date", { ascending: false }).range(from, to);
  });
  return rows.map(mapSearchAdRow);
}

/**
 * Top 키워드 표용 — **DB에서 키워드별 합산·정렬 후 상위 N개만** 받는다(옵션 B).
 * analytics.searchad_top_keywords(hospital, type, start, end, limit) RPC 호출.
 * 키워드 원시 행(수십만)을 브라우저로 끌지 않고 집계 결과(N행)만 내려받아 기간 무관 즉시 렌더.
 */
export async function fetchSearchAdTopKeywords(
  hospitalId: string,
  campaignType: string | undefined,
  startDate: string,
  endDate: string,
  limit = 10,
): Promise<KeywordPerf[]> {
  const supabase = createClient();
  // 6개월 하한을 한 번 더 보장(어떤 경우에도 6개월 초과 집계 금지).
  const since = searchAdSinceDate();
  const effStart = startDate > since ? startDate : since;
  const { data, error } = await supabase.schema("analytics").rpc("searchad_top_keywords", {
    p_hospital_id: hospitalId,
    p_campaign_type: campaignType ?? null,
    p_start: effStart,
    p_end: endDate,
    p_limit: limit,
  });
  if (error) throw error;
  const rows = (data ?? []) as Record<string, unknown>[];
  return rows.map((r) => ({
    keywordId: asStringOrNull(r.keyword_id) ?? "",
    keywordName: asStringOrNull(r.keyword_name) ?? asStringOrNull(r.keyword_id) ?? "",
    totals: {
      impressions: asNumberOrNull(r.impressions) ?? 0,
      clicks: asNumberOrNull(r.clicks) ?? 0,
      cost: asNumberOrNull(r.cost) ?? 0,
    },
  }));
}

export async function fetchKeywordTargets(params: {
  hospitalId: string | "all";
  isAdmin: boolean;
}): Promise<KeywordTargetRow[]> {
  const supabase = createClient();
  let q = supabase
    .schema("analytics")
    .from("analytics_blog_keyword_targets")
    .select("id,account_id,hospital_id,keyword,is_active,source,metadata,created_at,updated_at")
    .order("keyword", { ascending: true });

  if (!params.isAdmin || params.hospitalId !== "all") {
    if (params.hospitalId === "all") {
      return [] as KeywordTargetRow[];
    }
    q = q.eq("hospital_id", params.hospitalId);
  }

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as KeywordTargetRow[];
}

export async function insertKeywordTarget(input: {
  account_id: string;
  hospital_id: string;
  keyword: string;
}): Promise<void> {
  const supabase = createClient();
  const keyword = input.keyword.trim();
  if (!keyword) throw new Error("키워드를 입력하세요.");

  const { error } = await supabase
    .schema("analytics")
    .from("analytics_blog_keyword_targets")
    .insert({
      account_id: input.account_id.trim(),
      hospital_id: input.hospital_id,
      keyword,
      is_active: true,
      source: "dashboard",
      updated_at: new Date().toISOString(),
    });
  if (error) throw error;
}

export async function updateKeywordTarget(
  id: number,
  patch: Partial<Pick<KeywordTargetRow, "is_active" | "keyword">>
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .schema("analytics")
    .from("analytics_blog_keyword_targets")
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteKeywordTarget(id: number): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .schema("analytics")
    .from("analytics_blog_keyword_targets")
    .delete()
    .eq("id", id);
  if (error) throw error;
}
