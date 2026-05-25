"use client";

import { useEffect, useState } from "react";
import { useHospital } from "@/components/shell/hospital-context";
import {
  fetchBlogPeriodKpis,
  fetchSummaryBlogRanks,
  type BlogPeriodDayRow,
  type BlogRankSummaryRow,
} from "@/lib/queries";
import BlogMetricSection from "@/components/dashboard/BlogMetricSection";
import BlogRanksSection from "@/components/dashboard/BlogRanksSection";

type LoadState = "loading" | "error" | "done";

export default function BlogDashboardPage() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [blogRows, setBlogRows] = useState<BlogPeriodDayRow[]>([]);
  const [rankRows, setRankRows] = useState<BlogRankSummaryRow[]>([]);

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

        const [blogData, ranksData] = await Promise.all([
          fetchBlogPeriodKpis(hid),
          fetchSummaryBlogRanks(hid),
        ]);

        if (!cancelled) {
          setHospitalId(hid);
          setBlogRows(blogData);
          setRankRows(ranksData);
          setLoadState("done");
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "데이터를 불러오는 중 오류가 발생했습니다."
          );
          setLoadState("error");
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [ctxHospitalId]);

  if (loadState === "loading") {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "300px",
          color: "var(--text-muted)",
          fontSize: "14px",
        }}
      >
        데이터를 불러오는 중...
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div
        style={{
          margin: "24px",
          padding: "16px",
          border: "1px solid var(--danger)",
          borderRadius: "var(--radius)",
          background: "var(--danger-subtle)",
          color: "var(--danger)",
          fontSize: "14px",
        }}
      >
        {error ?? "알 수 없는 오류"}
      </div>
    );
  }

  if (!hospitalId) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "300px",
          color: "var(--text-muted)",
          fontSize: "14px",
        }}
      >
        병원 정보가 없습니다. 관리자에게 문의하세요.
      </div>
    );
  }

  return (
    <div>
      <div style={{ padding: "20px 20px 8px" }}>
        <h1
          style={{
            fontSize: "16px",
            fontWeight: 700,
            color: "var(--text)",
            margin: 0,
          }}
        >
          블로그
        </h1>
        <p
          style={{
            marginTop: "4px",
            fontSize: "13px",
            color: "var(--text-secondary)",
          }}
        >
          네이버 블로그 조회수, 방문자, 키워드 순위 현황입니다.
        </p>
      </div>

      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          overflow: "hidden",
          margin: "0 20px 16px",
        }}
      >
        <BlogMetricSection
          title="블로그 조회수"
          description="일별·월별·연별 블로그 조회수 추이입니다."
          rows={blogRows}
          metric="views"
          valueSuffix="회"
        />
        <BlogMetricSection
          title="순 방문자 수"
          description="일별·월별·연별 블로그 순 방문자 수 추이입니다."
          rows={blogRows}
          metric="uniqueVisitors"
          valueSuffix="명"
        />
      </div>

      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          overflow: "hidden",
          margin: "0 20px 24px",
        }}
      >
        <BlogRanksSection
          rows={rankRows}
          hospitalId={hospitalId}
          variant="detailed"
          title="주요 키워드 · 블로그 노출 순위"
          description="가장 최신 수집 기준, 주요 키워드별 네이버 블로그 노출 순위입니다."
          headingId="blog-ranks-heading"
        />
      </div>
    </div>
  );
}
