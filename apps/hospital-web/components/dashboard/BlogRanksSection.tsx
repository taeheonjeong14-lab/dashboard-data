"use client";

import { useEffect, useMemo, useState } from "react";
import {
  fetchBlogKeywordRankTrend,
  type BlogRankSummaryRow,
  type BlogRankTrendPoint,
} from "@/lib/queries";
import { dashboardBlogPreviewRequestUrl } from "@/lib/dashboard-api";

function formatRank(value: number): string {
  return `${new Intl.NumberFormat("ko-KR").format(value)}위`;
}

type RankPart = {
  id: string;
  title: string;
  rankKey:
    | "blog_rank_tab"
    | "blog_rank_pet_popular"
    | "blog_rank_general"
    | "blog_rank_integrated";
  urlKey:
    | "blog_rank_tab_url"
    | "blog_rank_pet_popular_url"
    | "blog_rank_general_url"
    | "blog_rank_integrated_url";
  trendKey:
    | "blog_rank_tab_trend"
    | "blog_rank_pet_popular_trend"
    | "blog_rank_general_trend"
    | "blog_rank_integrated_trend";
};

const PARTS: RankPart[] = [
  {
    id: "tab",
    title: "블로그탭",
    rankKey: "blog_rank_tab",
    urlKey: "blog_rank_tab_url",
    trendKey: "blog_rank_tab_trend",
  },
  {
    id: "pet_popular",
    title: "반려동물 인기글",
    rankKey: "blog_rank_pet_popular",
    urlKey: "blog_rank_pet_popular_url",
    trendKey: "blog_rank_pet_popular_trend",
  },
  {
    id: "general",
    title: "일반 검색",
    rankKey: "blog_rank_general",
    urlKey: "blog_rank_general_url",
    trendKey: "blog_rank_general_trend",
  },
  {
    id: "integrated",
    title: "네이버 통합검색",
    rankKey: "blog_rank_integrated",
    urlKey: "blog_rank_integrated_url",
    trendKey: "blog_rank_integrated_trend",
  },
];

export type BlogRanksSectionProps = {
  rows: BlogRankSummaryRow[];
  hospitalId?: string | null;
  loading?: boolean;
  /** 섹션 제목 */
  title?: string;
  /** 보조 설명 */
  description?: string;
  /** aria-labelledby 용 id */
  headingId?: string;
  /** HOME 요약에서는 단순 표, 블로그 페이지에서는 상세 표기 */
  variant?: "detailed" | "simple";
};

type RankEntry = {
  keyword: string;
  rank: number;
  url: string | null;
};

type PreviewTitleData = {
  title: string | null;
  finalUrl: string;
};

type HoveredRank = {
  keyword: string;
  partId: RankPart["id"];
  x: number;
  y: number;
};

function pickPartEntries(rows: BlogRankSummaryRow[], part: RankPart): RankEntry[] {
  return rows
    .map((row) => {
      const rank = row[part.rankKey];
      if (rank == null) return null;
      return {
        keyword: row.keyword,
        rank,
        url: row[part.urlKey],
      } satisfies RankEntry;
    })
    .filter((entry): entry is RankEntry => entry !== null)
    .sort((a, b) => a.rank - b.rank || a.keyword.localeCompare(b.keyword, "ko"));
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}

function TrendIcon({ trend }: { trend: -1 | 0 | 1 }) {
  if (trend > 0) {
    return (
      <span className="text-xs font-semibold text-[var(--success)]" title="상승">
        &uarr;
      </span>
    );
  }
  if (trend < 0) {
    return (
      <span className="text-xs font-semibold text-[var(--danger)]" title="하락">
        &darr;
      </span>
    );
  }
  return (
    <span className="text-xs font-semibold text-[var(--text-secondary)]" title="변동 없음">
      &mdash;
    </span>
  );
}

export default function BlogRanksSection({
  rows,
  hospitalId = null,
  loading = false,
  title = "주요 키워드 · 블로그 노출 순위",
  description = "가장 최신 수집 기준, 주요 키워드별 네이버 블로그 노출 순위입니다.",
  headingId = "blog-ranks-section",
  variant = "detailed",
}: BlogRanksSectionProps) {
  const [previewTitles, setPreviewTitles] = useState<Record<string, PreviewTitleData>>({});
  const [trendCache, setTrendCache] = useState<Record<string, BlogRankTrendPoint[]>>({});
  const [trendLoading, setTrendLoading] = useState<Record<string, boolean>>({});
  const [hoveredRank, setHoveredRank] = useState<HoveredRank | null>(null);

  const trendByKeyword = useMemo(() => {
    const map = new Map<string, BlogRankSummaryRow>();
    for (const row of rows) map.set(row.keyword, row);
    return map;
  }, [rows]);

  const urlsToFetch = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) {
      if (row.blog_rank_tab != null && row.blog_rank_tab_url)
        set.add(row.blog_rank_tab_url);
      if (row.blog_rank_pet_popular != null && row.blog_rank_pet_popular_url) {
        set.add(row.blog_rank_pet_popular_url);
      }
      if (row.blog_rank_general != null && row.blog_rank_general_url)
        set.add(row.blog_rank_general_url);
      if (row.blog_rank_integrated != null && row.blog_rank_integrated_url) {
        set.add(row.blog_rank_integrated_url);
      }
    }
    return Array.from(set.values());
  }, [rows]);

  useEffect(() => {
    const pending = urlsToFetch.filter((url) => !previewTitles[url]);
    if (pending.length === 0) return;

    let cancelled = false;
    Promise.all(
      pending.map(async (url) => {
        try {
          const res = await fetch(dashboardBlogPreviewRequestUrl(url));
          const data = (await res.json()) as
            | { ok: true; title: string | null; finalUrl: string }
            | { ok: false };
          if (!data || !("ok" in data) || !data.ok) return null;
          return { url, title: data.title, finalUrl: data.finalUrl };
        } catch {
          return null;
        }
      })
    ).then((results) => {
      if (cancelled) return;
      const next: Record<string, PreviewTitleData> = {};
      for (const item of results) {
        if (!item) continue;
        next[item.url] = { title: item.title, finalUrl: item.finalUrl };
      }
      if (Object.keys(next).length === 0) return;
      setPreviewTitles((prev) => ({ ...prev, ...next }));
    });

    return () => {
      cancelled = true;
    };
  }, [urlsToFetch, previewTitles]);

  const ensureTrendLoaded = (keyword: string) => {
    if (!hospitalId || trendCache[keyword] || trendLoading[keyword]) return;
    setTrendLoading((prev) => ({ ...prev, [keyword]: true }));
    fetchBlogKeywordRankTrend(hospitalId, keyword)
      .then((points) => {
        setTrendCache((prev) => ({ ...prev, [keyword]: points }));
      })
      .catch(() => {
        setTrendCache((prev) => ({ ...prev, [keyword]: [] }));
      })
      .finally(() => {
        setTrendLoading((prev) => ({ ...prev, [keyword]: false }));
      });
  };

  const renderRankCell = (
    entry: RankEntry,
    trend: -1 | 0 | 1,
    keyword: string,
    part: RankPart
  ) => {
    const text = formatRank(entry.rank);
    return (
      <span
        className="inline-flex items-center gap-1.5 text-[var(--text)]"
        onMouseEnter={(event) => {
          ensureTrendLoaded(keyword);
          setHoveredRank({
            keyword,
            partId: part.id,
            x: event.clientX,
            y: event.clientY,
          });
        }}
        onMouseMove={(event) => {
          setHoveredRank((prev) =>
            prev && prev.keyword === keyword && prev.partId === part.id
              ? { ...prev, x: event.clientX, y: event.clientY }
              : prev
          );
        }}
        onMouseLeave={() => setHoveredRank(null)}
      >
        <span>{text}</span>
        <TrendIcon trend={trend} />
      </span>
    );
  };

  const renderContentCell = (entry: RankEntry) => {
    if (!entry.url) return <span className="text-[var(--text-muted)]">-</span>;
    const preview = previewTitles[entry.url];
    if (!preview) return <span className="text-[var(--text-muted)]">불러오는 중&hellip;</span>;

    const previewTitle = preview.title?.trim();
    if (!previewTitle) return <span className="text-[var(--text-muted)]">-</span>;

    return (
      <a
        href={preview.finalUrl || entry.url}
        target="_blank"
        rel="noreferrer"
        className="underline underline-offset-2 text-[var(--accent)] hover:opacity-80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]"
        title={previewTitle}
      >
        {truncateText(previewTitle, 22)}
      </a>
    );
  };

  const renderTrendPopover = () => {
    if (!hoveredRank) return null;
    const part = PARTS.find((item) => item.id === hoveredRank.partId);
    if (!part) return null;

    const keywordPoints = trendCache[hoveredRank.keyword] ?? [];
    const loadingTrend = !!trendLoading[hoveredRank.keyword];
    const series = keywordPoints
      .map((point) => ({ dateKey: point.dateKey, value: point[part.rankKey] }))
      .filter(
        (point): point is { dateKey: string; value: number } => point.value != null
      );

    const width = 220;
    const height = 92;
    const pad = 8;
    const min = series.length > 0 ? Math.min(...series.map((item) => item.value)) : 1;
    const max = series.length > 0 ? Math.max(...series.map((item) => item.value)) : 1;
    const range = Math.max(1, max - min);
    const toX = (index: number) =>
      pad +
      (series.length <= 1
        ? (width - pad * 2) / 2
        : (index * (width - pad * 2)) / (series.length - 1));
    const toY = (value: number) =>
      pad + ((value - min) / range) * (height - pad * 2);
    const d = series
      .map(
        (item, index) =>
          `${index === 0 ? "M" : "L"} ${toX(index)} ${toY(item.value)}`
      )
      .join(" ");

    const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1200;
    const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 800;
    const left = Math.min(hoveredRank.x + 14, viewportWidth - 260);
    const top = Math.min(hoveredRank.y + 14, viewportHeight - 220);

    return (
      <div
        className="pointer-events-none fixed z-[60] w-[250px] border border-[var(--border-strong)] bg-white/95 p-2.5 shadow-xl"
        style={{ left, top }}
      >
        <p className="text-xs font-medium text-[var(--text)]">{hoveredRank.keyword}</p>
        <p className="mb-2 text-[11px] text-[var(--text-muted)]">
          {part.title} &middot; 최근 6개월
        </p>
        {loadingTrend && (
          <p className="text-xs text-[var(--text-muted)]">불러오는 중&hellip;</p>
        )}
        {!loadingTrend && series.length < 2 && (
          <p className="text-xs italic text-[var(--text-muted)]">
            추세를 그릴 데이터가 부족합니다.
          </p>
        )}
        {!loadingTrend && series.length >= 2 && (
          <>
            <svg viewBox={`0 0 ${width} ${height}`} className="h-[92px] w-full">
              <path d={d} fill="none" stroke="#3182F6" strokeWidth="2" />
            </svg>
            <div className="mt-1 flex justify-between text-[10px] text-[var(--text-muted)]">
              <span>{series[0].dateKey}</span>
              <span>{series.at(-1)?.dateKey}</span>
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <>
      <section
        aria-labelledby={headingId}
        className={`${variant === "simple" ? "" : "bg-[var(--bg-raised)] "}p-4 sm:p-5`}
      >
        {title && (
          <h2 id={headingId} className="mb-2 text-base font-semibold text-[var(--text)] sm:text-lg">
            {title}
          </h2>
        )}
        {description && <p className="mb-3 text-sm text-[var(--text-muted)]">{description}</p>}
        {loading && (
          <p className="text-sm text-[var(--text-secondary)]">데이터를 불러오는 중...</p>
        )}
        {!loading && rows.length === 0 && (
          <div className="flex flex-col items-center gap-2 border border-[var(--border)] bg-[var(--bg-subtle)] px-6 py-9 text-center">
            <span className="text-3xl text-[var(--text-muted)]">📝</span>
            <p className="text-sm font-semibold text-[var(--text-secondary)]">블로그 순위 데이터가 없습니다</p>
            <p className="text-xs text-[var(--text-muted)]">수집된 데이터가 있으면 여기에 표시됩니다.</p>
          </div>
        )}
        {!loading && rows.length > 0 && (
          <>
            {variant === "simple" ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-[var(--text-secondary)]">
                      <th className="py-1.5 pr-2 font-medium">검색어</th>
                      {PARTS.map((part) => (
                        <th key={part.id} className="py-1.5 px-2 font-medium">
                          {part.title}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr
                        key={row.keyword}
                        className="border-b border-[var(--border)] text-[var(--text)]"
                      >
                        <td className="py-1.5 pr-2">{row.keyword}</td>
                        {PARTS.map((part) => {
                          const rank = row[part.rankKey];
                          return (
                            <td
                              key={`${row.keyword}:${part.id}`}
                              className="py-1.5 px-2"
                            >
                              {rank == null ? (
                                <span className="text-[var(--text-muted)]">-</span>
                              ) : (
                                formatRank(rank)
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {PARTS.map((part) => {
                  const entries = pickPartEntries(rows, part);
                  return (
                    <div key={part.id}>
                      <h3 className="mb-1 text-sm font-semibold text-[var(--text)]">
                        {part.title}
                      </h3>
                      {entries.length === 0 ? (
                        <p className="text-xs italic text-[var(--text-muted)]">
                          표시할 키워드가 없습니다.
                        </p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full border-collapse text-left text-sm">
                            <thead>
                              <tr className="border-b border-[var(--border)] text-[var(--text-secondary)]">
                                <th className="py-1.5 pr-2 font-medium">검색어</th>
                                <th className="py-1.5 px-2 font-medium">순위</th>
                                <th className="py-1.5 pl-2 font-medium">컨텐츠</th>
                              </tr>
                            </thead>
                            <tbody>
                              {entries.map((entry) => (
                                <tr
                                  key={`${part.id}:${entry.keyword}`}
                                  className="border-b border-[var(--border)] text-[var(--text)]"
                                >
                                  <td className="py-1.5 pr-2">{entry.keyword}</td>
                                  <td className="py-1.5 px-2">
                                    {renderRankCell(
                                      entry,
                                      trendByKeyword.get(entry.keyword)?.[
                                        part.trendKey
                                      ] ?? 0,
                                      entry.keyword,
                                      part
                                    )}
                                  </td>
                                  <td className="py-1.5 pl-2">
                                    {renderContentCell(entry)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </section>
      {variant === "detailed" ? renderTrendPopover() : null}
    </>
  );
}
