/**
 * 병원 데이터(관리자) 대시보드의 데이터 조회 — hospital 경영 대시보드와 같은 화면을 그리되,
 * 데이터는 admin 관리자 API(/api/admin/stats/*)로 가져온다.
 * 함수 이름·시그니처는 hospital lib/queries.ts 와 맞춰 두었다(복사해 온 컴포넌트가 그대로 쓰도록).
 */
import type {
  BlogPeriodDayRow,
  BlogRankSummaryRow,
  BlogRankTrendPoint,
  HospitalManagementDayRow,
  PlacePeriodDayRow,
  PlaceRankSummaryRow,
  PlaceReviewStats,
  SearchAdRow,
} from '@/lib/hospital-dashboard/types';
import type { KeywordPerf } from '@/lib/hospital-dashboard/searchad-aggregates';

// 복사해 온 hospital 페이지·컴포넌트가 '@/lib/queries' 에서 타입도 함께 import 하므로 그대로 재수출한다.
export type * from '@/lib/hospital-dashboard/types';

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: 'include' });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
  return data;
}

const stats = (endpoint: string, params: Record<string, string>) =>
  `/api/admin/stats/${endpoint}?${new URLSearchParams(params).toString()}`;

export async function fetchHospitalManagementKpis(hospitalId: string): Promise<HospitalManagementDayRow[]> {
  const d = await getJson<{ rows?: HospitalManagementDayRow[] }>(stats('management', { hospitalId }));
  return d.rows ?? [];
}

export async function fetchBlogPeriodKpis(hospitalId: string): Promise<BlogPeriodDayRow[]> {
  const d = await getJson<{ rows?: BlogPeriodDayRow[] }>(stats('blog-period', { hospitalId }));
  return d.rows ?? [];
}

export async function fetchSummaryBlogRanks(hospitalId: string): Promise<BlogRankSummaryRow[]> {
  const d = await getJson<{ rows?: BlogRankSummaryRow[] }>(stats('blog-ranks', { hospitalId }));
  return d.rows ?? [];
}

export async function fetchBlogKeywordRankTrend(hospitalId: string, keyword: string): Promise<BlogRankTrendPoint[]> {
  const d = await getJson<{ rows?: BlogRankTrendPoint[] }>(stats('blog-rank-trend', { hospitalId, keyword }));
  return d.rows ?? [];
}

export async function fetchPlacePeriodKpis(hospitalId: string): Promise<PlacePeriodDayRow[]> {
  const d = await getJson<{ rows?: PlacePeriodDayRow[] }>(stats('place-period', { hospitalId }));
  return d.rows ?? [];
}

export async function fetchSummaryPlaceRanks(hospitalId: string): Promise<PlaceRankSummaryRow[]> {
  const d = await getJson<{ rows?: PlaceRankSummaryRow[] }>(stats('place-ranks', { hospitalId }));
  return d.rows ?? [];
}

export async function fetchPlaceReviewStats(hospitalId: string): Promise<PlaceReviewStats> {
  const d = await getJson<{ stats: PlaceReviewStats }>(stats('place-reviews', { hospitalId }));
  return d.stats;
}

export async function fetchSearchAdMetrics(hospitalId: string, campaignType?: string): Promise<SearchAdRow[]> {
  const params: Record<string, string> = { hospitalId };
  if (campaignType) params.campaignType = campaignType;
  const d = await getJson<{ rows?: SearchAdRow[] }>(stats('searchad', params));
  return d.rows ?? [];
}

export async function fetchSearchAdTopKeywords(
  hospitalId: string,
  campaignType: string | undefined,
  startDate: string,
  endDate: string,
  limit = 10,
): Promise<KeywordPerf[]> {
  const params: Record<string, string> = { hospitalId, start: startDate, end: endDate, limit: String(limit) };
  if (campaignType) params.campaignType = campaignType;
  const d = await getJson<{ rows?: KeywordPerf[] }>(stats('searchad-top-keywords', params));
  return d.rows ?? [];
}

/** 수의사 수(1인당 지표용) — 병원 정보에서. 없으면 null. */
export async function fetchVetCount(hospitalId: string): Promise<number | null> {
  try {
    const d = await getJson<{ hospital?: { vet_count?: unknown } }>(`/api/admin/data/hospitals/${encodeURIComponent(hospitalId)}`);
    const n = Number(d.hospital?.vet_count);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}
