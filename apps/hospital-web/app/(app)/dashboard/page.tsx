"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useHospital } from "@/components/shell/hospital-context";
import { CenteredSpinner } from "@/components/ui/loading-spinner";
import {
  fetchSummaryKpis,
  fetchSummaryBlogRanks,
  fetchSummaryPlaceRanks,
  type SummaryKpis,
  type BlogRankSummaryRow,
  type PlaceRankSummaryRow,
} from "@/lib/queries";
import SummaryDualWeekCompareChart from "@/components/dashboard/SummaryDualWeekCompareChart";
import BlogRanksSection from "@/components/dashboard/BlogRanksSection";

type LoadState = "loading" | "error" | "done";

export default function DashboardSummaryPage() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [kpis, setKpis] = useState<SummaryKpis | null>(null);
  const [blogRanks, setBlogRanks] = useState<BlogRankSummaryRow[]>([]);
  const [placeRanks, setPlaceRanks] = useState<PlaceRankSummaryRow[]>([]);

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

        const [kpisData, blogRanksData, placeRanksData] = await Promise.all([
          fetchSummaryKpis(hid),
          fetchSummaryBlogRanks(hid),
          fetchSummaryPlaceRanks(hid),
        ]);

        if (!cancelled) {
          setHospitalId(hid);
          setKpis(kpisData);
          setBlogRanks(blogRanksData);
          setPlaceRanks(placeRanksData);
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

  const totalSalesCurrent = sumNonNull(kpis?.salesCurrentWeek);
  const totalSalesPrevious = sumNonNull(kpis?.salesPreviousWeek);
  const salesDelta = totalSalesPrevious > 0
    ? ((totalSalesCurrent - totalSalesPrevious) / totalSalesPrevious) * 100
    : null;
  const totalNewCurrent = sumNonNull(kpis?.newCustomersCurrentWeek);
  const totalNewPrevious = sumNonNull(kpis?.newCustomersPreviousWeek);
  const newDelta = totalNewPrevious > 0
    ? ((totalNewCurrent - totalNewPrevious) / totalNewPrevious) * 100
    : null;

  const hasKpiData =
    kpis &&
    (kpis.salesCurrentWeek.some((v) => v != null) ||
      kpis.newCustomersCurrentWeek.some((v) => v != null));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* KPI 섹션 */}
      <section>
        <h2 style={sectionHeading}>최근 7일 KPI 현황</h2>
        {!hasKpiData ? (
          <EmptyCard icon="📊" title="경영 데이터가 없습니다" description="우측 상단 ‘경영통계 제출’ 버튼으로 엑셀 파일을 업로드해 주세요." />
        ) : (
          <>
            {/* Summary KPI numbers */}
            <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
              <KpiSummaryCard
                label="매출 합계 (최근 7일)"
                value={formatSales(totalSalesCurrent)}
                delta={salesDelta}
              />
              <KpiSummaryCard
                label="신규 고객 (최근 7일)"
                value={`${totalNewCurrent.toLocaleString('ko-KR')}명`}
                delta={newDelta}
              />
            </div>
            {/* Comparison charts */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px' }}>
              <div>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>매출 일별 추이 (최근 vs 직전 7일)</p>
                <SummaryDualWeekCompareChart
                  ariaLabel="최근 7일 vs 직전 7일 매출 비교 차트"
                  variant="currency"
                  currentWeek={kpis?.salesCurrentWeek}
                  previousWeek={kpis?.salesPreviousWeek}
                  datePairs={kpis?.datePairs}
                />
              </div>
              <div>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>신규 고객 일별 추이 (최근 vs 직전 7일)</p>
                <SummaryDualWeekCompareChart
                  ariaLabel="최근 7일 vs 직전 7일 신규 고객 비교 차트"
                  variant="integer"
                  currentWeek={kpis?.newCustomersCurrentWeek}
                  previousWeek={kpis?.newCustomersPreviousWeek}
                  datePairs={kpis?.datePairs}
                />
              </div>
            </div>
          </>
        )}
      </section>

      {/* 블로그 순위 섹션 */}
      <section>
        <h2 style={sectionHeading}>블로그 키워드 순위 요약</h2>
        {blogRanks.length === 0 ? (
          <EmptyCard icon="📝" title="블로그 순위 데이터가 없습니다" description="최신 수집 기준 네이버 블로그 노출 순위입니다." />
        ) : (
          <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', background: 'var(--bg-raised)' }}>
            <BlogRanksSection
              rows={blogRanks}
              hospitalId={hospitalId}
              variant="simple"
              title=""
              description="최신 수집 기준 네이버 블로그 노출 순위입니다."
              headingId="summary-blog-ranks"
            />
          </div>
        )}
      </section>

      {/* 플레이스 순위 섹션 */}
      <section>
        <h2 style={sectionHeading}>플레이스 키워드 순위 요약</h2>
        {placeRanks.length === 0 ? (
          <EmptyCard icon="📍" title="플레이스 순위 데이터가 없습니다" description="네이버 플레이스 키워드 순위 데이터가 수집되면 여기에 표시됩니다." />
        ) : (
          <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-raised)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                  <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 500 }}>검색어</th>
                  <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 500 }}>순위</th>
                </tr>
              </thead>
              <tbody>
                {placeRanks.map((row) => (
                  <tr key={row.keyword} style={{ borderBottom: '1px solid var(--border)', color: 'var(--text)' }}>
                    <td style={{ padding: '10px 16px' }}>{row.keyword}</td>
                    <td style={{ padding: '10px 16px' }}>
                      {row.rank_value != null ? (
                        `${new Intl.NumberFormat('ko-KR').format(row.rank_value)}위`
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>-</span>
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

const sectionHeading: CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  marginBottom: '12px',
};

function sumNonNull(arr?: (number | null)[]): number {
  return (arr ?? []).reduce<number>((acc, v) => acc + (v ?? 0), 0);
}

function formatSales(val: number): string {
  if (val >= 100_000_000) return `${(val / 100_000_000).toFixed(1)}억원`;
  if (val >= 10_000) return `${Math.floor(val / 10_000).toLocaleString('ko-KR')}만원`;
  return `${val.toLocaleString('ko-KR')}원`;
}

function KpiSummaryCard({ label, value, delta }: { label: string; value: string; delta: number | null }) {
  const isPos = delta != null && delta > 0;
  const isNeg = delta != null && delta < 0;
  return (
    <div style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '16px 20px', flex: 1, minWidth: 150 }}>
      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>{label}</div>
      <div style={{ fontSize: '26px', fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em', lineHeight: 1.2 }}>{value}</div>
      {delta != null && (
        <div style={{ fontSize: '12px', marginTop: '8px', color: isPos ? 'var(--success)' : isNeg ? 'var(--danger)' : 'var(--text-muted)' }}>
          {isPos ? '▲' : isNeg ? '▼' : '—'} {Math.abs(delta).toFixed(1)}% vs 직전 7일
        </div>
      )}
    </div>
  );
}

function EmptyCard({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <div style={{
      padding: '36px 24px',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      background: 'var(--bg-raised)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      textAlign: 'center',
      gap: '8px',
    }}>
      <div style={{ fontSize: '28px', color: 'var(--text-muted)' }}>{icon}</div>
      <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-secondary)' }}>{title}</div>
      <div style={{ fontSize: '12px', color: 'var(--text-muted)', maxWidth: '280px' }}>{description}</div>
    </div>
  );
}
