/** 네이버 검색광고 성과 집계 helper. campaign/adgroup/keyword 레벨 분리 + 기간 합산. */

import type { SearchAdRow } from "@/lib/queries";

export type SearchAdMetricKey = "impressions" | "clicks" | "ctr" | "cost" | "cpc";
export type Granularity = "day" | "month" | "year";

export type PerfTotals = {
  impressions: number;
  clicks: number;
  cost: number;
};

export type CampaignPerf = {
  campaignId: string;
  campaignName: string;
  totals: PerfTotals;
  adgroups: {
    adgroupId: string;
    adgroupName: string;
    totals: PerfTotals;
  }[];
};

export type KeywordPerf = {
  keywordId: string;
  keywordName: string;
  totals: PerfTotals;
};

const isCampaignLevel = (r: SearchAdRow) =>
  r.campaignId !== "" && r.adgroupId === "" && r.keywordId === "";
const isAdgroupLevel = (r: SearchAdRow) =>
  r.campaignId !== "" && r.adgroupId !== "" && r.keywordId === "";
const isKeywordLevel = (r: SearchAdRow) => r.keywordId !== "";

const inRange = (dateKey: string, start: string, end: string) =>
  dateKey >= start && dateKey <= end;

function emptyTotals(): PerfTotals {
  return { impressions: 0, clicks: 0, cost: 0 };
}

function addInto(acc: PerfTotals, r: SearchAdRow) {
  acc.impressions += r.impressions;
  acc.clicks += r.clicks;
  acc.cost += r.cost;
}

/** 기간 합산값에서 지표를 도출. CTR·CPC 는 절대 일별 평균이 아니라 합계에서 계산. */
export function deriveMetric(t: PerfTotals, metric: SearchAdMetricKey): number | null {
  switch (metric) {
    case "impressions":
      return t.impressions;
    case "clicks":
      return t.clicks;
    case "cost":
      return t.cost;
    case "ctr":
      return t.impressions > 0 ? (t.clicks / t.impressions) * 100 : null;
    case "cpc":
      return t.clicks > 0 ? t.cost / t.clicks : null;
    default:
      return null;
  }
}

/** 데이터 날짜 경계 (campaign-level 기준; 없으면 전체). */
export function getDataBounds(rows: SearchAdRow[]): { min: string; max: string } | null {
  const src = rows.filter((r) => r.dateKey);
  if (src.length === 0) return null;
  let min = src[0].dateKey;
  let max = src[0].dateKey;
  for (const r of src) {
    if (r.dateKey < min) min = r.dateKey;
    if (r.dateKey > max) max = r.dateKey;
  }
  return { min, max };
}

/** 캠페인 표 (각 캠페인 합산 + 그 아래 광고그룹 합산). */
export function buildCampaignTable(
  rows: SearchAdRow[],
  start: string,
  end: string,
): CampaignPerf[] {
  const campaignMap = new Map<string, { name: string; totals: PerfTotals }>();
  for (const r of rows) {
    if (!isCampaignLevel(r) || !inRange(r.dateKey, start, end)) continue;
    const prev = campaignMap.get(r.campaignId) ?? {
      name: r.campaignName ?? r.campaignId,
      totals: emptyTotals(),
    };
    if (r.campaignName) prev.name = r.campaignName;
    addInto(prev.totals, r);
    campaignMap.set(r.campaignId, prev);
  }

  const adgroupMap = new Map<
    string,
    Map<string, { name: string; totals: PerfTotals }>
  >();
  for (const r of rows) {
    if (!isAdgroupLevel(r) || !inRange(r.dateKey, start, end)) continue;
    const byCampaign = adgroupMap.get(r.campaignId) ?? new Map();
    const prev = byCampaign.get(r.adgroupId) ?? {
      name: r.adgroupName ?? r.adgroupId,
      totals: emptyTotals(),
    };
    if (r.adgroupName) prev.name = r.adgroupName;
    addInto(prev.totals, r);
    byCampaign.set(r.adgroupId, prev);
    adgroupMap.set(r.campaignId, byCampaign);
  }

  const result: CampaignPerf[] = [];
  for (const [campaignId, c] of campaignMap.entries()) {
    const ag = adgroupMap.get(campaignId);
    const adgroups = ag
      ? Array.from(ag.entries())
          .map(([adgroupId, a]) => ({
            adgroupId,
            adgroupName: a.name,
            totals: a.totals,
          }))
          .sort((x, y) => y.totals.clicks - x.totals.clicks)
      : [];
    result.push({
      campaignId,
      campaignName: c.name,
      totals: c.totals,
      adgroups,
    });
  }
  return result.sort((a, b) => b.totals.clicks - a.totals.clicks);
}

/** 클릭수 상위 키워드. */
export function buildTopKeywords(
  rows: SearchAdRow[],
  start: string,
  end: string,
  topN = 10,
): KeywordPerf[] {
  const map = new Map<string, { name: string; totals: PerfTotals }>();
  for (const r of rows) {
    if (!isKeywordLevel(r) || !inRange(r.dateKey, start, end)) continue;
    const prev = map.get(r.keywordId) ?? {
      name: r.keywordName ?? r.keywordId,
      totals: emptyTotals(),
    };
    if (r.keywordName) prev.name = r.keywordName;
    addInto(prev.totals, r);
    map.set(r.keywordId, prev);
  }
  return Array.from(map.entries())
    .map(([keywordId, k]) => ({ keywordId, keywordName: k.name, totals: k.totals }))
    .sort((a, b) => b.totals.clicks - a.totals.clicks)
    .slice(0, topN);
}

function bucketKey(dateKey: string, granularity: Granularity): string {
  if (granularity === "year") return dateKey.slice(0, 4);
  if (granularity === "month") return dateKey.slice(0, 7);
  return dateKey;
}

function bucketLabel(key: string, granularity: Granularity): string {
  if (granularity === "year") return `${key}년`;
  if (granularity === "month") return key;
  return key.slice(5).replace("-", "/");
}

export type CampaignTrend = {
  /** recharts data: 각 point 가 {label, sortKey, [campaignId]: number|null} */
  points: Array<Record<string, string | number | null>>;
  /** 라인으로 그릴 캠페인 목록 (클릭 합 내림차순) */
  campaigns: { id: string; name: string }[];
};

/** 캠페인별 멀티라인 추세. metric 별로 기간 버킷마다 값 산출. */
export function buildCampaignTrend(
  rows: SearchAdRow[],
  start: string,
  end: string,
  granularity: Granularity,
  metric: SearchAdMetricKey,
  maxCampaigns = 8,
): CampaignTrend {
  const campRows = rows.filter(
    (r) => isCampaignLevel(r) && inRange(r.dateKey, start, end),
  );

  // 캠페인 메타 + 전체 클릭 합 (라인 선택 우선순위)
  const campMeta = new Map<string, { name: string; clicks: number }>();
  for (const r of campRows) {
    const prev = campMeta.get(r.campaignId) ?? {
      name: r.campaignName ?? r.campaignId,
      clicks: 0,
    };
    if (r.campaignName) prev.name = r.campaignName;
    prev.clicks += r.clicks;
    campMeta.set(r.campaignId, prev);
  }
  const campaigns = Array.from(campMeta.entries())
    .map(([id, m]) => ({ id, name: m.name, clicks: m.clicks }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, maxCampaigns)
    .map(({ id, name }) => ({ id, name }));
  const campaignIds = new Set(campaigns.map((c) => c.id));

  // (campaignId → bucketKey → totals)
  const byCampBucket = new Map<string, Map<string, PerfTotals>>();
  const bucketSet = new Set<string>();
  for (const r of campRows) {
    if (!campaignIds.has(r.campaignId)) continue;
    const bk = bucketKey(r.dateKey, granularity);
    bucketSet.add(bk);
    const buckets = byCampBucket.get(r.campaignId) ?? new Map<string, PerfTotals>();
    const t = buckets.get(bk) ?? emptyTotals();
    addInto(t, r);
    buckets.set(bk, t);
    byCampBucket.set(r.campaignId, buckets);
  }

  const sortedBuckets = Array.from(bucketSet).sort();
  const points = sortedBuckets.map((bk) => {
    const point: Record<string, string | number | null> = {
      label: bucketLabel(bk, granularity),
      sortKey: bk,
    };
    for (const c of campaigns) {
      const t = byCampBucket.get(c.id)?.get(bk) ?? null;
      point[c.id] = t ? deriveMetric(t, metric) : null;
    }
    return point;
  });

  return { points, campaigns };
}
