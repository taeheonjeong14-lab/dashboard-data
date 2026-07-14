"use client";

import { useEffect, useState } from "react";
import { useHospital } from "@/components/hospital-dashboard/context";
import { CenteredSpinner } from "@/components/hospital-dashboard/spinner";
import {
  fetchPlacePeriodKpis,
  fetchSummaryPlaceRanks,
  fetchPlaceReviewStats,
  type PlacePeriodDayRow,
  type PlaceRankSummaryRow,
  type PlaceReviewStats,
} from "@/lib/hospital-dashboard/queries";
import PlaceInflowSection from "@/components/hospital-dashboard/PlaceInflowSection";
import PlaceReviewStatsSection from "@/components/hospital-dashboard/PlaceReviewStatsSection";

type LoadState = "loading" | "error" | "done";

/** "YYYY-MM-DD" → "YYYY년 MM월 DD일" */
function formatCollectedDate(dateKey: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateKey);
  if (!m) return dateKey;
  return `${m[1]}년 ${m[2]}월 ${m[3]}일`;
}

/** 순위 변동 화살표 (블로그 탭과 동일: 상승=초록↑, 하락=빨강↓, 동일/비교불가=회색—) */
function TrendArrow({ trend }: { trend: -1 | 0 | 1 }) {
  if (trend > 0) {
    return (
      <span style={{ fontSize: 14, fontWeight: 600, color: "var(--success)" }} title="상승">
        ↑
      </span>
    );
  }
  if (trend < 0) {
    return (
      <span style={{ fontSize: 14, fontWeight: 600, color: "var(--danger)" }} title="하락">
        ↓
      </span>
    );
  }
  return (
    <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-secondary)" }} title="변동 없음">
      —
    </span>
  );
}

export default function PlaceDashboardPage() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [placeRows, setPlaceRows] = useState<PlacePeriodDayRow[]>([]);
  const [rankRows, setRankRows] = useState<PlaceRankSummaryRow[]>([]);
  const [reviewStats, setReviewStats] = useState<PlaceReviewStats | null>(null);

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

        const [placeData, ranksData, reviewData] = await Promise.all([
          fetchPlacePeriodKpis(hid),
          fetchSummaryPlaceRanks(hid),
          fetchPlaceReviewStats(hid),
        ]);

        if (!cancelled) {
          setHospitalId(hid);
          setPlaceRows(placeData);
          setRankRows(ranksData);
          setReviewStats(reviewData);
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
    return <CenteredSpinner minHeight="60vh" />;
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
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 24 }}>
      {/* 좌측: 플레이스 키워드 순위 (3) — 흰 배경 카드로 우측 그래프와 구분 */}
      <section style={{ flex: "3 1 300px", minWidth: 0, background: "var(--bg)", borderRadius: "var(--radius-lg)", padding: 20 }}>
        <h2
          style={{
            fontSize: "16px",
            fontWeight: 600,
            color: "var(--text)",
            marginBottom: "4px",
          }}
        >
          플레이스 키워드 순위
        </h2>
        {(() => {
          const latestText = rankRows[0]?.latestDateKey
            ? formatCollectedDate(rankRows[0].latestDateKey)
            : null;
          const baselineText = rankRows[0]?.baselineDateKey
            ? formatCollectedDate(rankRows[0].baselineDateKey)
            : null;
          if (!latestText && !baselineText) return null;
          return (
            <div style={{ marginBottom: 12, display: "flex", flexDirection: "column", gap: 2 }}>
              {latestText && (
                <p style={{ margin: 0, fontSize: 14, color: "var(--text-muted)" }}>
                  최신 수집 날짜: {latestText}
                </p>
              )}
              {baselineText && (
                <p style={{ margin: 0, fontSize: 14, color: "var(--text-muted)" }}>
                  순위 비교 날짜: {baselineText}
                </p>
              )}
            </div>
          );
        })()}
        {rankRows.length === 0 ? (
          <p
            style={{
              padding: "16px",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              color: "var(--text-muted)",
              fontSize: "13px",
            }}
          >
            데이터 없음
          </p>
        ) : (
          <div
            style={{
              overflowX: "auto",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
            }}
          >
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "13px",
              }}
            >
              <thead>
                <tr
                  style={{
                    borderBottom: "1px solid var(--border)",
                    color: "var(--text-secondary)",
                  }}
                >
                  <th
                    style={{
                      padding: "8px 12px",
                      textAlign: "left",
                      fontWeight: 500,
                    }}
                  >
                    검색어
                  </th>
                  <th
                    style={{
                      padding: "8px 12px",
                      textAlign: "left",
                      fontWeight: 500,
                    }}
                  >
                    순위
                  </th>
                </tr>
              </thead>
              <tbody>
                {rankRows.map((row) => (
                  <tr
                    key={row.keyword}
                    style={{
                      borderBottom: "1px solid var(--border)",
                      color: "var(--text)",
                    }}
                  >
                    <td style={{ padding: "8px 12px" }}>{row.keyword}</td>
                    <td style={{ padding: "8px 12px" }}>
                      {row.rank_value != null ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          {`${new Intl.NumberFormat("ko-KR").format(row.rank_value)}위`}
                          <TrendArrow trend={row.rank_value_trend} />
                        </span>
                      ) : (
                        <span style={{ color: "var(--text-muted)" }}>-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 우측: 플레이스 유입수 그래프 (7) */}
      <div style={{ flex: "7 1 360px", minWidth: 0 }}>
        <PlaceInflowSection rows={placeRows} />
      </div>
      </div>

      {/* 플레이스 리뷰 통계 (플레이스 키워드 순위 아래) */}
      {reviewStats ? <PlaceReviewStatsSection stats={reviewStats} /> : null}
    </div>
  );
}
