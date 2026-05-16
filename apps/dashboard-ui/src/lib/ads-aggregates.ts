import type { SearchAdDailyRow } from "./queries";

export type AdsMetric = "impressions" | "clicks" | "ctr" | "cost";

export type AdsTotalPoint = {
  label: string;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  cost: number | null;
};

export type CampaignInfo = { id: string; name: string };

function addNullable(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}

function dateLabel(dateKey: string): string {
  const m = dateKey.slice(5, 7);
  const d = dateKey.slice(8, 10);
  return `${Number(m)}/${Number(d)}`;
}

export function addDaysFromDateKey(dateKey: string, delta: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + delta * 86400000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

export function getDataBounds(rows: SearchAdDailyRow[]): { min: string; max: string } | null {
  if (rows.length === 0) return null;
  let min = rows[0].dateKey;
  let max = rows[0].dateKey;
  for (const r of rows) {
    if (r.dateKey < min) min = r.dateKey;
    if (r.dateKey > max) max = r.dateKey;
  }
  return { min, max };
}

export function buildAdsTotalSeries(
  rows: SearchAdDailyRow[],
  start: string,
  end: string
): AdsTotalPoint[] {
  const byDate = new Map<string, { impressions: number | null; clicks: number | null; cost: number | null }>();

  for (const row of rows) {
    if (row.dateKey < start || row.dateKey > end) continue;
    const prev = byDate.get(row.dateKey);
    if (prev) {
      byDate.set(row.dateKey, {
        impressions: addNullable(prev.impressions, row.impressions),
        clicks: addNullable(prev.clicks, row.clicks),
        cost: addNullable(prev.cost, row.cost),
      });
    } else {
      byDate.set(row.dateKey, {
        impressions: row.impressions,
        clicks: row.clicks,
        cost: row.cost,
      });
    }
  }

  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dk, v]) => ({
      label: dateLabel(dk),
      impressions: v.impressions,
      clicks: v.clicks,
      cost: v.cost,
      ctr:
        v.impressions != null && v.impressions > 0 && v.clicks != null
          ? (v.clicks / v.impressions) * 100
          : null,
    }));
}

export function getCampaigns(rows: SearchAdDailyRow[]): CampaignInfo[] {
  const seen = new Map<string, string>();
  for (const r of rows) {
    if (r.campaignId && !seen.has(r.campaignId)) {
      seen.set(r.campaignId, r.campaignName ?? r.campaignId);
    }
  }
  return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
}

export function buildCampaignCtrSeries(
  rows: SearchAdDailyRow[],
  start: string,
  end: string,
  campaigns: CampaignInfo[]
): Array<Record<string, string | number | null>> {
  const byDateCampaign = new Map<
    string,
    { impressions: number | null; clicks: number | null }
  >();
  const dateSet = new Set<string>();

  for (const row of rows) {
    if (row.dateKey < start || row.dateKey > end) continue;
    dateSet.add(row.dateKey);
    const key = `${row.dateKey}::${row.campaignId}`;
    const prev = byDateCampaign.get(key);
    if (prev) {
      byDateCampaign.set(key, {
        impressions: addNullable(prev.impressions, row.impressions),
        clicks: addNullable(prev.clicks, row.clicks),
      });
    } else {
      byDateCampaign.set(key, { impressions: row.impressions, clicks: row.clicks });
    }
  }

  return Array.from(dateSet)
    .sort()
    .map((dk) => {
      const point: Record<string, string | number | null> = { label: dateLabel(dk) };
      for (const { id } of campaigns) {
        const v = byDateCampaign.get(`${dk}::${id}`);
        if (v && v.impressions != null && v.impressions > 0 && v.clicks != null) {
          point[id] = (v.clicks / v.impressions) * 100;
        } else {
          point[id] = null;
        }
      }
      return point;
    });
}
