"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PlaceReviewStats } from "@/lib/hospital-dashboard/types";

function formatReviewDate(dateKey: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateKey);
  if (!m) return dateKey || "—";
  return `${m[1]}.${m[2]}.${m[3]}`;
}

export default function PlaceReviewStatsSection({ stats }: { stats: PlaceReviewStats }) {
  const posTotal = stats.strongPositiveCount + stats.positiveCount;
  const negTotal = stats.negativeCount + stats.strongNegativeCount;
  const sentimentBase = posTotal + negTotal;
  const pct = (n: number) => (sentimentBase > 0 ? (n / sentimentBase) * 100 : 0);
  const pctR = (n: number) => Math.round(pct(n));
  const hasMonthly = stats.monthly.some((m) => m.count > 0);

  // 막대 4구간(중립 제외): 강한긍정 → 긍정 → 부정 → 강한부정
  const segments = [
    { key: "sp", count: stats.strongPositiveCount, color: "var(--success)", opacity: 1, label: "강한 긍정" },
    { key: "p", count: stats.positiveCount, color: "var(--success)", opacity: 0.45, label: "긍정" },
    { key: "n", count: stats.negativeCount, color: "var(--danger)", opacity: 0.45, label: "부정" },
    { key: "sn", count: stats.strongNegativeCount, color: "var(--danger)", opacity: 1, label: "강한 부정" },
  ];

  return (
    <section style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 24, paddingBottom: 24 }}>
      {/* ── 좌측 (3): 리뷰 긍정/부정 평가 — 흰 배경 카드 ── */}
      <div style={{ flex: "3 1 300px", minWidth: 0, background: "var(--bg)", borderRadius: "var(--radius-lg)", padding: 20 }}>
        <h2 className="text-base font-semibold text-[var(--text)]" style={{ marginBottom: 8 }}>
          플레이스 리뷰 긍정/부정 평가
        </h2>
        <p className="text-xs text-[var(--text-muted)]" style={{ marginBottom: 16 }}>
          최근 6개월(방문일 기준) · 긍정/부정은 AI 분류 결과
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {/* 리뷰 긍정지수 */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-[var(--text)]">리뷰 긍정지수</h3>
            {sentimentBase === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">
                아직 긍정/부정으로 분류된 리뷰가 없습니다.
              </p>
            ) : (
              <div>
                <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--text-secondary)]">
                  <span>
                    <span style={{ color: "var(--success)" }}>●</span> 강한 긍정 {pctR(stats.strongPositiveCount)}%
                  </span>
                  <span>
                    <span style={{ color: "var(--success)", opacity: 0.55 }}>●</span> 긍정 {pctR(stats.positiveCount)}%
                  </span>
                  <span>
                    <span style={{ color: "var(--danger)", opacity: 0.55 }}>●</span> 부정 {pctR(stats.negativeCount)}%
                  </span>
                  <span>
                    <span style={{ color: "var(--danger)" }}>●</span> 강한 부정 {pctR(stats.strongNegativeCount)}%
                  </span>
                </div>
                <div className="flex h-8 w-full overflow-hidden rounded border border-[var(--border)]">
                  {segments.map((s) =>
                    s.count > 0 ? (
                      <div
                        key={s.key}
                        style={{ width: `${pct(s.count)}%`, background: s.color, opacity: s.opacity }}
                        title={`${s.label} ${s.count}개 (${pctR(s.count)}%)`}
                      />
                    ) : null,
                  )}
                </div>
                {stats.neutralCount > 0 ? (
                  <div className="mt-1.5 text-xs text-[var(--text-muted)]">
                    중립 {stats.neutralCount}개 (지수에서 제외)
                  </div>
                ) : null}
              </div>
            )}
          </div>

          {/* 부정 리뷰 목록 (강한 부정 먼저) */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-[var(--text)]">
              부정 리뷰
              {stats.negativeReviews.length > 0 ? (
                <span className="ml-1.5 font-normal text-[var(--text-muted)]">
                  {stats.negativeReviews.length}개
                </span>
              ) : null}
            </h3>
            {stats.negativeReviews.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">부정으로 분류된 리뷰가 없습니다.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-[var(--text-secondary)]">
                      <th className="whitespace-nowrap py-1.5 pr-3 font-medium">방문일</th>
                      <th className="whitespace-nowrap py-1.5 pr-3 font-medium">아이디</th>
                      <th className="py-1.5 font-medium">내용</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.negativeReviews.map((r, i) => (
                      <tr
                        key={`${r.reviewDate}-${r.authorId ?? ""}-${i}`}
                        className="border-b border-[var(--border)] align-top text-[var(--text)]"
                      >
                        <td className="whitespace-nowrap py-2 pr-3 text-[var(--text-secondary)]">
                          {formatReviewDate(r.reviewDate)}
                        </td>
                        <td className="whitespace-nowrap py-2 pr-3 text-[var(--text-secondary)]">
                          {r.authorId || "—"}
                        </td>
                        <td className="py-2 leading-relaxed">
                          {r.strong ? (
                            <span
                              className="mr-1.5 inline-block rounded px-1.5 py-0.5 align-middle text-[10px] font-semibold"
                              style={{ background: "var(--danger-subtle)", color: "var(--danger)" }}
                            >
                              강한 부정
                            </span>
                          ) : null}
                          {r.content || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── 우측 (8): 월별 리뷰 갯수 바그래프 ── */}
      <div style={{ flex: "8 1 360px", minWidth: 0 }}>
        <h2 className="text-base font-semibold text-[var(--text)]" style={{ marginBottom: 8 }}>
          플레이스 리뷰 추이
        </h2>
        {!hasMonthly ? (
          <p className="text-xs text-[var(--text-muted)]">표시할 데이터가 없습니다.</p>
        ) : (
          <div className="h-[300px] w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={200}>
              <BarChart data={stats.monthly} margin={{ top: 8, right: 12, bottom: 8, left: 4 }}>
                <CartesianGrid stroke="#e5e8eb" strokeDasharray="3 3" />
                <XAxis
                  dataKey="monthLabel"
                  stroke="#d1d6db"
                  tick={{ fill: "#8b95a1", fontSize: 11 }}
                />
                <YAxis
                  stroke="#d1d6db"
                  tick={{ fill: "#8b95a1", fontSize: 11 }}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#ffffff",
                    border: "1px solid #e5e8eb",
                    borderRadius: "8px",
                  }}
                  labelStyle={{ color: "#191f28" }}
                  formatter={(value) => [`${value}개`, "리뷰 수"]}
                />
                <Bar dataKey="count" name="리뷰 수" fill="#3182F6" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </section>
  );
}
