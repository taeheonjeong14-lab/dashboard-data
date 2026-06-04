"use client";

import { useEffect, useState } from "react";
import { useHospital } from "@/components/shell/hospital-context";
import { CenteredSpinner } from "@/components/ui/loading-spinner";
import {
  fetchCompetitors,
  fetchCompetitorRanks,
  fetchSummaryBlogRanks,
  fetchSummaryPlaceRanks,
  type HospitalCompetitor,
  type CompetitorRank,
  type BlogRankSummaryRow,
  type PlaceRankSummaryRow,
} from "@/lib/queries";

type LoadState = "loading" | "error" | "done";

function formatRank(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${new Intl.NumberFormat("ko-KR").format(value)}위`;
}

/** 키워드 × [우리병원, 경쟁사…] 비교 표 */
function CompareTable({
  title,
  ourLabel,
  competitors,
  rows,
  getCompetitorRank,
}: {
  title: string;
  ourLabel: string;
  competitors: HospitalCompetitor[];
  rows: { keyword: string; ourRank: number | null }[];
  getCompetitorRank: (slot: number, keyword: string) => number | null;
}) {
  return (
    <section
      style={{
        flex: "1 1 360px",
        minWidth: 0,
        background: "var(--bg)",
        borderRadius: "var(--radius-lg)",
        padding: 20,
      }}
    >
      <h2 className="text-base font-semibold text-[var(--text)]" style={{ marginBottom: 12 }}>
        {title}
      </h2>
      {rows.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">추적 중인 키워드가 없습니다.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--text-secondary)]">
                <th className="whitespace-nowrap py-2 pr-3 font-medium">검색어</th>
                <th className="whitespace-nowrap py-2 px-3 font-semibold text-[var(--accent)]">
                  {ourLabel}
                </th>
                {competitors.map((c) => (
                  <th key={c.slot} className="whitespace-nowrap py-2 px-3 font-medium">
                    {c.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.keyword} className="border-b border-[var(--border)] text-[var(--text)]">
                  <td className="py-2 pr-3">{r.keyword}</td>
                  <td className="whitespace-nowrap py-2 px-3 font-medium text-[var(--accent)]">
                    {formatRank(r.ourRank)}
                  </td>
                  {competitors.map((c) => (
                    <td key={c.slot} className="whitespace-nowrap py-2 px-3 text-[var(--text)]">
                      {formatRank(getCompetitorRank(c.slot, r.keyword))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function CompetitorAnalysisPage() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [competitors, setCompetitors] = useState<HospitalCompetitor[]>([]);
  const [blogRows, setBlogRows] = useState<BlogRankSummaryRow[]>([]);
  const [placeRows, setPlaceRows] = useState<PlaceRankSummaryRow[]>([]);
  const [competitorRanks, setCompetitorRanks] = useState<CompetitorRank[]>([]);

  const { hospitalId: ctxHospitalId } = useHospital();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const hid = ctxHospitalId;
        if (!hid) {
          if (!cancelled) {
            setHospitalId(null);
            setLoadState("done");
          }
          return;
        }
        const [comps, blog, place, compRanks] = await Promise.all([
          fetchCompetitors(hid),
          fetchSummaryBlogRanks(hid),
          fetchSummaryPlaceRanks(hid),
          fetchCompetitorRanks(hid),
        ]);
        if (!cancelled) {
          setHospitalId(hid);
          setCompetitors(comps);
          setBlogRows(blog);
          setPlaceRows(place);
          setCompetitorRanks(compRanks);
          setLoadState("done");
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "데이터를 불러오는 중 오류가 발생했습니다.");
          setLoadState("error");
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [ctxHospitalId]);

  if (loadState === "loading") return <CenteredSpinner minHeight="60vh" />;
  if (loadState === "error") {
    return (
      <div
        style={{
          margin: 24,
          padding: 16,
          border: "1px solid var(--danger)",
          borderRadius: "var(--radius)",
          background: "var(--danger-subtle)",
          color: "var(--danger)",
          fontSize: 14,
        }}
      >
        {error ?? "알 수 없는 오류"}
      </div>
    );
  }
  if (!hospitalId) {
    return (
      <div style={{ minHeight: 300, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 14 }}>
        병원 정보가 없습니다. 관리자에게 문의하세요.
      </div>
    );
  }

  // 블로그: 블로그탭 순위 기준 / 플레이스: rank_value 기준
  const blogTableRows = blogRows.map((r) => ({ keyword: r.keyword, ourRank: r.blog_rank_tab }));
  const placeTableRows = placeRows.map((r) => ({ keyword: r.keyword, ourRank: r.rank_value }));

  const crMap = new Map<string, number | null>();
  for (const cr of competitorRanks) crMap.set(`${cr.channel}|${cr.slot}|${cr.keyword}`, cr.rank);
  const getBlogCompRank = (slot: number, keyword: string) => crMap.get(`blog|${slot}|${keyword}`) ?? null;
  const getPlaceCompRank = (slot: number, keyword: string) => crMap.get(`place|${slot}|${keyword}`) ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--text)" }}>경쟁병원 분석</h1>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-secondary)" }}>
          우리 병원과 경쟁 병원의 키워드별 노출 순위를 비교합니다.
          {competitors.length === 0
            ? " (관리자에서 경쟁 병원을 등록하면 비교 컬럼이 추가됩니다.)"
            : " (경쟁사 순위는 수집 후 채워집니다.)"}
        </p>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 24 }}>
        <CompareTable
          title="블로그 키워드 순위 (블로그탭)"
          ourLabel="우리 병원"
          competitors={competitors}
          rows={blogTableRows}
          getCompetitorRank={getBlogCompRank}
        />
        <CompareTable
          title="플레이스 키워드 순위"
          ourLabel="우리 병원"
          competitors={competitors}
          rows={placeTableRows}
          getCompetitorRank={getPlaceCompRank}
        />
      </div>
    </div>
  );
}
