"use client";

import { useEffect, useState } from "react";
import { useHospital } from "@/components/shell/hospital-context";
import {
  fetchPlacePeriodKpis,
  fetchSummaryPlaceRanks,
  type PlacePeriodDayRow,
  type PlaceRankSummaryRow,
} from "@/lib/queries";
import PlaceInflowSection from "@/components/dashboard/PlaceInflowSection";

type LoadState = "loading" | "error" | "done";

export default function PlaceDashboardPage() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [placeRows, setPlaceRows] = useState<PlacePeriodDayRow[]>([]);
  const [rankRows, setRankRows] = useState<PlaceRankSummaryRow[]>([]);

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

        const [placeData, ranksData] = await Promise.all([
          fetchPlacePeriodKpis(hid),
          fetchSummaryPlaceRanks(hid),
        ]);

        if (!cancelled) {
          setHospitalId(hid);
          setPlaceRows(placeData);
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
          플레이스
        </h1>
        <p
          style={{
            marginTop: "4px",
            fontSize: "13px",
            color: "var(--text-secondary)",
          }}
        >
          네이버 스마트플레이스 유입 현황과 키워드 순위입니다.
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
        <PlaceInflowSection rows={placeRows} />
      </div>

      {/* 플레이스 키워드 순위 */}
      <section style={{ padding: "0 20px 24px" }}>
        <h2
          style={{
            fontSize: "15px",
            fontWeight: 600,
            color: "var(--text)",
            marginBottom: "12px",
          }}
        >
          플레이스 키워드 순위
        </h2>
        <p
          style={{
            fontSize: "13px",
            color: "var(--text-secondary)",
            marginBottom: "12px",
          }}
        >
          최신 수집 기준 네이버 스마트플레이스 검색 순위입니다.
        </p>
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
                        `${new Intl.NumberFormat("ko-KR").format(row.rank_value)}위`
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
    </div>
  );
}
