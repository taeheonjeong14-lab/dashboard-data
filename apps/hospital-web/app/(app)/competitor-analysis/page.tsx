"use client";

import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, BarChart } from "recharts";
import { useHospital } from "@/components/shell/hospital-context";
import { CenteredSpinner } from "@/components/ui/loading-spinner";
import {
  fetchCompetitors,
  fetchMonthlyReviewCounts,
  fetchRankSeries,
  type HospitalCompetitor,
  type MonthlyReviewCount,
  type RankSeries,
} from "@/lib/queries";

type LoadState = "loading" | "error" | "done";

const SERIES_COLORS = ["var(--accent)", "#10b981", "#f59e0b", "#ef4444"];

/** 우리/경쟁 선 정의(등록된 경쟁사만) */
function seriesDefs(competitors: HospitalCompetitor[]) {
  const defs: { key: "own" | "c1" | "c2" | "c3"; name: string; color: string }[] = [
    { key: "own", name: "우리 병원", color: SERIES_COLORS[0] },
  ];
  for (const c of competitors) {
    const key = (`c${c.slot}`) as "c1" | "c2" | "c3";
    defs.push({ key, name: c.name || `경쟁 ${c.slot}`, color: SERIES_COLORS[c.slot] ?? "#64748b" });
  }
  return defs;
}

/** 키워드 선택 + 날짜축 순위 추이 라인차트 (순위는 낮을수록 좋아 Y축 반전) */
function RankChartCard({
  title,
  series,
  competitors,
}: {
  title: string;
  series: RankSeries;
  competitors: HospitalCompetitor[];
}) {
  const [keyword, setKeyword] = useState<string>("");
  const kw = keyword || series.keywords[0] || "";
  const data = (kw && series.byKeyword[kw]) || [];
  const defs = useMemo(() => seriesDefs(competitors), [competitors]);

  return (
    <section style={card}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
        <h2 className="text-base font-semibold text-[var(--text)]" style={{ margin: 0 }}>{title}</h2>
        {series.keywords.length > 0 ? (
          <select value={kw} onChange={(e) => setKeyword(e.target.value)} style={selectStyle}>
            {series.keywords.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        ) : null}
      </div>
      {data.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">추적 중인 순위 데이터가 없습니다. (경쟁사는 수집 후 채워집니다.)</p>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d: string) => d.slice(5)} />
            <YAxis reversed allowDecimals={false} width={36} tick={{ fontSize: 11 }} domain={[1, "dataMax"]} label={{ value: "순위", angle: -90, position: "insideLeft", fontSize: 11 }} />
            <Tooltip formatter={(v) => (v == null ? "미노출" : `${v}위`)} contentStyle={{ fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {defs.map((d) => (
              <Line key={d.key} type="monotone" dataKey={d.key} name={d.name} stroke={d.color} strokeWidth={2} dot={{ r: 2 }} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
      <p className="text-xs text-[var(--text-muted)]" style={{ marginTop: 8 }}>위로 갈수록 상위 노출입니다. 미노출 구간은 선이 이어집니다.</p>
    </section>
  );
}

export default function CompetitorAnalysisPage() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [competitors, setCompetitors] = useState<HospitalCompetitor[]>([]);
  const [blogSeries, setBlogSeries] = useState<RankSeries>({ keywords: [], byKeyword: {} });
  const [placeSeries, setPlaceSeries] = useState<RankSeries>({ keywords: [], byKeyword: {} });
  const [reviewCounts, setReviewCounts] = useState<MonthlyReviewCount[]>([]);

  const { hospitalId: ctxHospitalId } = useHospital();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const hid = ctxHospitalId;
        if (!hid) {
          if (!cancelled) { setHospitalId(null); setLoadState("done"); }
          return;
        }
        const [comps, blog, place, reviews] = await Promise.all([
          fetchCompetitors(hid),
          fetchRankSeries(hid, "blog"),
          fetchRankSeries(hid, "place"),
          fetchMonthlyReviewCounts(hid),
        ]);
        if (!cancelled) {
          setHospitalId(hid);
          setCompetitors(comps);
          setBlogSeries(blog);
          setPlaceSeries(place);
          setReviewCounts(reviews);
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
    return () => { cancelled = true; };
  }, [ctxHospitalId]);

  if (loadState === "loading") return <CenteredSpinner minHeight="60vh" />;
  if (loadState === "error") {
    return (
      <div style={{ margin: 24, padding: 16, border: "1px solid var(--danger)", borderRadius: "var(--radius)", background: "var(--danger-subtle)", color: "var(--danger)", fontSize: 14 }}>
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

  const reviewDefs = seriesDefs(competitors);
  const reviewEmpty = reviewCounts.every((r) => r.own === 0 && r.c1 === 0 && r.c2 === 0 && r.c3 === 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--text)" }}>경쟁병원 분석</h1>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-secondary)" }}>
          우리 병원과 경쟁 병원의 검색 노출 순위·리뷰 추이를 비교합니다.
          {competitors.length === 0 ? " (관리자에서 경쟁 병원을 등록하면 비교 항목이 추가됩니다.)" : ""}
        </p>
      </div>

      <RankChartCard title="블로그 순위 추이 (블로그탭)" series={blogSeries} competitors={competitors} />
      <RankChartCard title="플레이스 순위 추이" series={placeSeries} competitors={competitors} />

      <section style={card}>
        <h2 className="text-base font-semibold text-[var(--text)]" style={{ marginBottom: 12 }}>월별 리뷰 갯수 (최근 1년)</h2>
        {reviewEmpty ? (
          <p className="text-xs text-[var(--text-muted)]">
            수집된 리뷰가 없습니다. (경쟁병원은 관리자에서 스마트플레이스 리뷰 URL 등록 후 수집됩니다.)
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={reviewCounts} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} tickFormatter={(m: string) => m.slice(2)} />
              <YAxis tick={{ fontSize: 11 }} width={36} allowDecimals={false} />
              <Tooltip contentStyle={{ fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {reviewDefs.map((d) => (
                <Bar key={d.key} dataKey={d.key} name={d.name} fill={d.color} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
        <p className="text-xs text-[var(--text-muted)]" style={{ marginTop: 8 }}>
          월별 네이버 스마트플레이스 방문자 리뷰 수입니다. (감성 분석은 우리 병원만 제공)
        </p>
      </section>
    </div>
  );
}

const card: React.CSSProperties = { background: "var(--bg)", borderRadius: "var(--radius-lg)", padding: 20 };
const selectStyle: React.CSSProperties = {
  padding: "6px 10px", fontSize: 13, borderRadius: "var(--radius)", border: "1px solid var(--border)",
  background: "var(--bg)", color: "var(--text)", outline: "none", maxWidth: 240,
};
