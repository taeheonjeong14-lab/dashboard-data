import { createServiceRoleClient } from '@/lib/supabase/service-role';

import type { SearchAdRow, PlaceReviewStats, BlogRankSummaryRow as HdBlogRankSummaryRow, PlaceRankSummaryRow as HdPlaceRankSummaryRow, KeywordImportance } from "@/lib/hospital-dashboard/types";
import type { KeywordPerf } from "@/lib/hospital-dashboard/searchad-aggregates";

/** 서버 전용 — analytics 조회는 관리자 API에서만 호출 (RLS 우회 service_role). */
function getSupabaseClient() {
  return createServiceRoleClient();
}

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
};

/** 플레이스 KPI 시계열 (analytics.chart_place_period_view). */
export type PlacePeriodDayRow = {
  dateKey: string;
  periodType: "day" | "month" | "year";
  inflow: number | null;
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

function toSeoulDateKey(d: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(d);
}

function addNullableKpi(a: number | null, b: number | null): number | null {
  if (a == null && b == null) return null;
  return (a ?? 0) + (b ?? 0);
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

/**
 * chart_kpis_period_view may contain mixed granularity rows (day/month/year).
 * We only want day-level rows, then aggregate in UI by month/year.
 */
function isDailyGranularityRow(row: Record<string, unknown>): boolean {
  const candidates = [
    row.period_type,
    row.period_granularity,
    row.granularity,
    row.period_unit,
    row.unit,
    row.bucket,
  ];
  const defined = candidates.filter((v) => v != null);
  if (defined.length === 0) return true;

  for (const raw of defined) {
    const v = String(raw).trim().toLowerCase();
    if (v === "day" || v === "daily" || v === "d" || v === "1d") return true;
  }
  return false;
}

function granularityOfRow(row: Record<string, unknown>): "day" | "week" | "month" | "year" | "unknown" {
  const candidates = [
    row.period_type,
    row.period_granularity,
    row.granularity,
    row.period_unit,
    row.unit,
    row.bucket,
  ];
  for (const raw of candidates) {
    if (raw == null) continue;
    const v = String(raw).trim().toLowerCase();
    if (v === "day" || v === "daily" || v === "d" || v === "1d") return "day";
    if (v === "week" || v === "weekly" || v === "w" || v === "1w") return "week";
    if (v === "month" || v === "monthly" || v === "m" || v === "1m") return "month";
    if (v === "year" || v === "yearly" || v === "y" || v === "1y") return "year";
  }
  return "unknown";
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

export async function fetchSummaryKpis(hospitalId: string): Promise<SummaryKpis> {
  const supabase = getSupabaseClient();

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

  const latestDate = Array.from(byDate.keys()).sort().at(-1) ?? addCalendarDaysUtc(todayDateKeySeoul(), -1);
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
  const supabase = getSupabaseClient();

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

/**
 * 디버그용: chart_kpis_period_view의 해당 병원 row를 가공 없이 그대로 반환.
 * 컬럼 구조/값 확인을 위해 사용.
 */
export async function fetchHospitalManagementRawRows(
  hospitalId: string
): Promise<Record<string, unknown>[]> {
  const supabase = getSupabaseClient();
  return await fetchAllPages((from, to) =>
    supabase
      .schema("analytics")
      .from("chart_kpis_period_view")
      .select("*")
      .eq("hospital_id", hospitalId)
      .order("period_start_date", { ascending: true })
      .range(from, to),
  );
}

export async function fetchBlogPeriodKpis(
  hospitalId: string
): Promise<BlogPeriodDayRow[]> {
  const supabase = getSupabaseClient();

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
        uniqueVisitors: firstNumber(rawRow, [
          "blog_unique_visitors",
          "unique_visitors",
        ]),
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

/** 블로그 순위 raw 일별 행 (요약 없이 키워드×날짜×4섹션 그대로). admin 분석 뷰용. */
export type BlogRankDailyRow = {
  dateKey: string;
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

/** analytics_blog_keyword_ranks_daily_view 를 요약 없이 raw 일별 행으로 반환(분석/피벗용). */
export async function fetchBlogRanksDaily(hospitalId: string): Promise<BlogRankDailyRow[]> {
  const supabase = getSupabaseClient();
  const rows = await fetchAllPages((from, to) =>
    supabase
      .schema("analytics")
      .from("analytics_blog_keyword_ranks_daily_view")
      .select("*")
      .eq("hospital_id", hospitalId)
      .order("metric_date", { ascending: true })
      .range(from, to),
  );
  return rows
    .map((row) => {
      const date = parseDateValue(row);
      if (!date) return null;
      return {
        dateKey: toSeoulDateKey(date),
        keyword: asStringOrNull(row.keyword) ?? "-",
        blog_rank_tab: asNumberOrNull(row.blog_rank_tab),
        blog_rank_general: asNumberOrNull(row.blog_rank_general),
        blog_rank_integrated: asNumberOrNull(row.blog_rank_integrated),
        blog_rank_pet_popular: asNumberOrNull(row.blog_rank_pet_popular),
        blog_rank_tab_url: asStringOrNull(row.blog_rank_tab_url),
        blog_rank_general_url: asStringOrNull(row.blog_rank_general_url),
        blog_rank_integrated_url: asStringOrNull(row.blog_rank_integrated_url),
        blog_rank_pet_popular_url:
          asStringOrNull(row.blog_rank_popular_url) ??
          asStringOrNull(row.blog_rank_pet_popular_url),
      } as BlogRankDailyRow;
    })
    .filter((r): r is BlogRankDailyRow => r !== null);
}

async function fetchSummaryBlogRanksLegacy(hospitalId: string): Promise<BlogRankSummaryRow[]> {
  const supabase = getSupabaseClient();
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
    .filter((item): item is { row: Record<string, unknown>; dateKey: string } => item !== null);

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
        blog_rank_integrated: asNumberOrNull(row.blog_rank_integrated) ?? prev.blog_rank_integrated,
        blog_rank_pet_popular: asNumberOrNull(row.blog_rank_pet_popular) ?? prev.blog_rank_pet_popular,
        blog_rank_tab_url: asStringOrNull(row.blog_rank_tab_url) ?? prev.blog_rank_tab_url,
        blog_rank_general_url: asStringOrNull(row.blog_rank_general_url) ?? prev.blog_rank_general_url,
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
          asStringOrNull(row.blog_rank_popular_url) ?? asStringOrNull(row.blog_rank_pet_popular_url),
      }))
      .sort((a, b) => a.keyword.localeCompare(b.keyword, "ko"));
  }

  const dateKeys = Array.from(new Set(stamped.map((item) => item.dateKey))).sort();
  const latestDateKey = dateKeys.at(-1) as string;
  const baselineTarget = addCalendarDaysUtc(latestDateKey, -30);
  const baselineDateKey = dateKeys.filter((key) => key <= baselineTarget).at(-1) ?? null;

  const latestRows = stamped.filter((item) => item.dateKey === latestDateKey).map((item) => item.row);
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
        blog_rank_general_trend: toTrend(current.blog_rank_general, previous?.blog_rank_general ?? null),
        blog_rank_integrated_trend: toTrend(
          current.blog_rank_integrated,
          previous?.blog_rank_integrated ?? null
        ),
        blog_rank_pet_popular_trend: toTrend(
          current.blog_rank_pet_popular,
          previous?.blog_rank_pet_popular ?? null
        ),
      } as BlogRankSummaryRow;
    })
    .sort((a, b) => a.keyword.localeCompare(b.keyword, "ko"));
}

export async function fetchBlogKeywordRankTrend(
  hospitalId: string,
  keyword: string
): Promise<BlogRankTrendPoint[]> {
  const supabase = getSupabaseClient();
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
    .filter((item): item is { row: Record<string, unknown>; dateKey: string } => item !== null);
  if (stamped.length === 0) return [];

  const latestDateKey = stamped.map((item) => item.dateKey).sort().at(-1) as string;
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
      blog_rank_general: asNumberOrNull(item.row.blog_rank_general) ?? prev.blog_rank_general,
      blog_rank_integrated: asNumberOrNull(item.row.blog_rank_integrated) ?? prev.blog_rank_integrated,
      blog_rank_pet_popular: asNumberOrNull(item.row.blog_rank_pet_popular) ?? prev.blog_rank_pet_popular,
    });
  }

  return Array.from(byDate.values()).sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

async function fetchSummaryPlaceRanksLegacy(hospitalId: string): Promise<PlaceRankSummaryRow[]> {
  const supabase = getSupabaseClient();
  const data = await fetchAllPages((from, to) =>
    supabase
      .schema("analytics")
      .from("analytics_place_keyword_ranks")
      .select("*")
      .eq("hospital_id", hospitalId)
      .order("metric_date", { ascending: true })
      .range(from, to),
  );

  return latestSnapshotRows(data)
    .map((row) => ({
      keyword: asStringOrNull(row.keyword) ?? "-",
      rank_value: asNumberOrNull(row.rank_value),
    }))
    .sort((a, b) => a.keyword.localeCompare(b.keyword, "ko"));
}

export async function fetchPlacePeriodKpis(
  hospitalId: string
): Promise<PlacePeriodDayRow[]> {
  const supabase = getSupabaseClient();
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
  if (fromView.length > 0) {
    if (process.env.NODE_ENV === "development") {
      console.info("[fetchPlacePeriodKpis] source=view(chart_place_period_view)", {
        hospitalId,
        rowCount: fromView.length,
      });
    }
    return fromView;
  }

  // Fallback: view가 비어 있으면 원본 일별 테이블을 직접 집계한다.
  if (process.env.NODE_ENV === "development") {
    console.info("[fetchPlacePeriodKpis] source=fallback(analytics_smartplace_daily_metrics)", {
      hospitalId,
      rawRowsFromView: mapped.length,
    });
  }
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

  if (process.env.NODE_ENV === "development") {
    console.info("[fetchPlacePeriodKpis] fallback_done", {
      hospitalId,
      rowCount: fallbackRows.length,
    });
  }

  return fallbackRows.sort((a, b) => {
    if (a.periodType === b.periodType) return a.dateKey.localeCompare(b.dateKey);
    return a.periodType.localeCompare(b.periodType);
  });
}

export async function fetchKeywordTargets(params: {
  hospitalId: string | "all";
  isAdmin: boolean;
}) {
  const supabase = getSupabaseClient();
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
}) {
  const supabase = getSupabaseClient();
  const keyword = input.keyword.trim();
  if (!keyword) throw new Error("키워드를 입력하세요.");

  const { error } = await supabase.schema("analytics").from("analytics_blog_keyword_targets").insert({
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
) {
  const supabase = getSupabaseClient();
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

export async function deleteKeywordTarget(id: number) {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .schema("analytics")
    .from("analytics_blog_keyword_targets")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

export type SearchAdDailyRow = {
  /** YYYY-MM-DD (Asia/Seoul 기준) */
  dateKey: string;
  campaignId: string;
  campaignName: string | null;
  impressions: number | null;
  clicks: number | null;
  cost: number | null;
};

export async function fetchSearchAdDailyMetrics(
  hospitalId: string
): Promise<SearchAdDailyRow[]> {
  const supabase = getSupabaseClient();
  const data = await fetchAllPages((from, to) =>
    supabase
      .schema("analytics")
      .from("analytics_searchad_daily_metrics")
      .select("metric_date,campaign_id,campaign_name,adgroup_id,impressions,clicks,cost")
      .eq("hospital_id", hospitalId)
      .eq("keyword_id", "")
      .order("metric_date", { ascending: true })
      .range(from, to),
  );

  type Bucket = {
    hasCampaignLevel: boolean;
    campaignVals: { impressions: number | null; clicks: number | null; cost: number | null };
    adgroupSum: { impressions: number | null; clicks: number | null; cost: number | null };
    campaignName: string | null;
  };
  const byKey = new Map<string, Bucket>();

  for (const row of data) {
    const raw = row.metric_date;
    if (!raw) continue;
    const dateKey = String(raw).slice(0, 10);
    const campaignId = String(row.campaign_id ?? "");
    const adgroupId = String(row.adgroup_id ?? "");
    const key = `${dateKey}::${campaignId}`;

    const impressions = asNumberOrNull(row.impressions);
    const clicks = asNumberOrNull(row.clicks);
    const cost = asNumberOrNull(row.cost);
    const campaignName =
      typeof row.campaign_name === "string" && row.campaign_name.trim()
        ? row.campaign_name.trim()
        : null;

    const prev = byKey.get(key) ?? {
      hasCampaignLevel: false,
      campaignVals: { impressions: null, clicks: null, cost: null },
      adgroupSum: { impressions: null, clicks: null, cost: null },
      campaignName: null,
    };

    if (adgroupId === "") {
      byKey.set(key, {
        ...prev,
        hasCampaignLevel: true,
        campaignVals: {
          impressions: addNullableKpi(prev.campaignVals.impressions, impressions),
          clicks: addNullableKpi(prev.campaignVals.clicks, clicks),
          cost: addNullableKpi(prev.campaignVals.cost, cost),
        },
        campaignName: campaignName ?? prev.campaignName,
      });
    } else {
      byKey.set(key, {
        ...prev,
        adgroupSum: {
          impressions: addNullableKpi(prev.adgroupSum.impressions, impressions),
          clicks: addNullableKpi(prev.adgroupSum.clicks, clicks),
          cost: addNullableKpi(prev.adgroupSum.cost, cost),
        },
        campaignName: campaignName ?? prev.campaignName,
      });
    }
  }

  return Array.from(byKey.entries())
    .map(([key, bucket]) => {
      const [dateKey, campaignId] = key.split("::");
      const vals = bucket.hasCampaignLevel ? bucket.campaignVals : bucket.adgroupSum;
      return {
        dateKey,
        campaignId,
        campaignName: bucket.campaignName,
        impressions: vals.impressions,
        clicks: vals.clicks,
        cost: vals.cost,
      };
    })
    .sort((a, b) => {
      if (a.dateKey !== b.dateKey) return a.dateKey.localeCompare(b.dateKey);
      return a.campaignId.localeCompare(b.campaignId);
    });
}

// ── 아래는 hospital 경영 대시보드와 같은 화면을 admin 에서 그리기 위해 옮겨온 쿼리다.
//    (hospital-web lib/queries.ts 의 같은 이름 함수와 짝 — 한쪽을 고치면 다른 쪽도 맞춰야 화면이 어긋나지 않는다)

const SEARCHAD_SELECT =
  "metric_date,campaign_id,campaign_name,campaign_type,adgroup_id,adgroup_name,keyword_id,keyword_name,impressions,clicks,cost";

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

export async function fetchSearchAdMetrics(
  hospitalId: string,
  campaignType?: string,
): Promise<SearchAdRow[]> {
  const supabase = getSupabaseClient();
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

export async function fetchSearchAdTopKeywords(
  hospitalId: string,
  campaignType: string | undefined,
  startDate: string,
  endDate: string,
  limit = 10,
): Promise<KeywordPerf[]> {
  const supabase = getSupabaseClient();
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
    const supabase = getSupabaseClient();
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

// ── 순위 요약(블로그·플레이스) — hospital 경영 대시보드와 같은 형태로 내려주기 위해 옮겨온 쿼리.
//    admin 자체 구현은 중요도(상/중/하)·기준일이 빠져 있어 같은 화면을 그릴 수 없었다.

const IMPORTANCE_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
/** 순위 화살표 비교 기준: 정확히 14일 전, 없으면 폴백(블로그·플레이스 공통) — hospital 과 동일. */
const RANK_BASELINE_OFFSET_PRIORITY = [14, 15, 13, 16, 12, 17, 11, 18, 10, 19, 20];
function importanceRank(v: string | null | undefined): number {
  const s = String(v ?? "").toLowerCase();
  return IMPORTANCE_ORDER[s] ?? 1; // 미지정은 '중' 취급
}

function normalizeImportance(v: unknown): KeywordImportance {
  const s = String(v ?? "").toLowerCase();
  return s === "high" || s === "low" ? s : "medium";
}

async function fetchKeywordImportanceMap(
  supabase: ReturnType<typeof getSupabaseClient>,
  table: "analytics_blog_keyword_targets" | "analytics_place_keyword_targets",
  hospitalId: string,
): Promise<Map<string, KeywordImportance>> {
  const map = new Map<string, KeywordImportance>();
  const { data, error } = await supabase
    .schema("analytics")
    .from(table)
    .select("keyword, importance")
    .eq("hospital_id", hospitalId)
    .eq("is_active", true);
  if (error || !data) return map;
  for (const row of data as Record<string, unknown>[]) {
    const kw = String(row.keyword ?? "").trim();
    if (kw) map.set(kw, normalizeImportance(row.importance));
  }
  return map;
}

function blogBestRank(r: {
  blog_rank_tab: number | null;
  blog_rank_general: number | null;
  blog_rank_integrated: number | null;
  blog_rank_pet_popular: number | null;
}): number {
  const vals = [r.blog_rank_tab, r.blog_rank_general, r.blog_rank_integrated, r.blog_rank_pet_popular].filter(
    (v): v is number => typeof v === "number",
  );
  return vals.length ? Math.min(...vals) : Number.POSITIVE_INFINITY;
}

function compareByImportanceThenRank(
  a: { importance: KeywordImportance; keyword: string },
  aRank: number,
  b: { importance: KeywordImportance; keyword: string },
  bRank: number,
): number {
  const d = importanceRank(a.importance) - importanceRank(b.importance);
  if (d !== 0) return d;
  if (aRank !== bRank) return aRank - bRank;
  return a.keyword.localeCompare(b.keyword, "ko");
}

export async function fetchSummaryBlogRanks(hospitalId: string): Promise<HdBlogRankSummaryRow[]> {
  const supabase = getSupabaseClient();
  const importanceMap = await fetchKeywordImportanceMap(supabase, "analytics_blog_keyword_targets", hospitalId);
  const impOf = (keyword: string): KeywordImportance => importanceMap.get(keyword.trim()) ?? "medium";
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
      .map((row) => {
        const keyword = asStringOrNull(row.keyword) ?? "-";
        return {
          keyword,
          importance: impOf(keyword),
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
        };
      })
      .sort((a, b) => compareByImportanceThenRank(a, blogBestRank(a), b, blogBestRank(b)));
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
        importance: impOf(current.keyword),
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
      } as HdBlogRankSummaryRow;
    })
    .sort((a, b) => compareByImportanceThenRank(a, blogBestRank(a), b, blogBestRank(b)));
}

function pickBaselineDateKey(latestDateKey: string, dateKeySet: Set<string>): string | null {
  return (
    RANK_BASELINE_OFFSET_PRIORITY.map((offset) => addCalendarDaysUtc(latestDateKey, -offset)).find(
      (key) => dateKeySet.has(key),
    ) ?? null
  );
}

function rankTrend(current: number | null, previous: number | null): -1 | 0 | 1 {
  if (current == null || previous == null) return 0;
  if (current < previous) return 1;
  if (current > previous) return -1;
  return 0;
}

export async function fetchSummaryPlaceRanks(
  hospitalId: string
): Promise<HdPlaceRankSummaryRow[]> {
  const supabase = getSupabaseClient();
  const importanceMap = await fetchKeywordImportanceMap(supabase, "analytics_place_keyword_targets", hospitalId);
  const impOf = (keyword: string): KeywordImportance => importanceMap.get(keyword.trim()) ?? "medium";
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
      .map((row) => {
        const keyword = asStringOrNull(row.keyword) ?? "-";
        return {
          keyword,
          importance: impOf(keyword),
          rank_value: asNumberOrNull(row.rank_value),
          rank_value_trend: 0 as const,
          latestDateKey: null,
          baselineDateKey: null,
        };
      })
      .sort((a, b) =>
        compareByImportanceThenRank(a, a.rank_value ?? Number.POSITIVE_INFINITY, b, b.rank_value ?? Number.POSITIVE_INFINITY),
      );
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
      importance: impOf(keyword),
      rank_value,
      rank_value_trend: rankTrend(rank_value, baselineMap.get(keyword) ?? null),
      latestDateKey,
      baselineDateKey,
    }))
    .sort((a, b) =>
      compareByImportanceThenRank(a, a.rank_value ?? Number.POSITIVE_INFINITY, b, b.rank_value ?? Number.POSITIVE_INFINITY),
    );
}
