'use client';

/**
 * 전체 현황 보드 — 병원별 "최근 4주 vs 직전 4주" 변화를 한 줄로.
 * 병원끼리 비교하는 화면이 아니다. 각 병원은 자기 과거와만 비교하고, 이 화면의 목적은
 * "오늘 어느 병원을 열어봐야 하는가"를 고르는 것(= 놓치지 않기).
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import Link from 'next/link';

type MetricDelta = { current: number; previous: number; changePct: number | null };
type OverviewRow = {
  hospitalId: string;
  hospitalName: string;
  metrics: {
    newPatients: MetricDelta;
    sales: MetricDelta;
    visits: MetricDelta;
    placeInflow: MetricDelta;
    blogViews: MetricDelta;
    adClicks: MetricDelta;
  };
  rankDrops: number;
  newNegativeReviews: number;
  freshness: { management: string | null; place: string | null; blog: string | null; ads: string | null };
};

type MetricKey = keyof OverviewRow['metrics'];

/** 열 정의 — 결과 지표(무엇이 아픈가) 다음에 선행 지표(왜 아픈가). 탭 경로도 함께(클릭 시 바로 이동). */
const COLUMNS: { key: MetricKey; label: string; tab: string; unit: 'count' | 'won' }[] = [
  { key: 'newPatients', label: '신규환자', tab: 'patients', unit: 'count' },
  { key: 'sales', label: '매출', tab: 'sales', unit: 'won' },
  { key: 'visits', label: '진료건수', tab: 'visits', unit: 'count' },
  { key: 'placeInflow', label: '플레이스 유입', tab: 'place', unit: 'count' },
  { key: 'blogViews', label: '블로그 조회수', tab: 'blog', unit: 'count' },
  { key: 'adClicks', label: '광고 클릭', tab: 'powerlink-ads', unit: 'count' },
];

/** 변화율 → 배경색. 악화는 빨강, 개선은 초록. 비교 불가(직전 0)면 회색. */
function cellColor(pct: number | null): { bg: string; fg: string } {
  if (pct == null) return { bg: 'var(--bg-subtle)', fg: 'var(--text-muted)' };
  const p = Math.max(-60, Math.min(60, pct));
  if (p <= -5) {
    const a = Math.min(0.42, Math.abs(p) / 60 * 0.42 + 0.06);
    return { bg: `rgba(229,72,77,${a.toFixed(2)})`, fg: '#7f1d1d' };
  }
  if (p >= 5) {
    const a = Math.min(0.34, p / 60 * 0.34 + 0.05);
    return { bg: `rgba(48,164,108,${a.toFixed(2)})`, fg: '#14532d' };
  }
  return { bg: 'transparent', fg: 'var(--text-secondary)' };
}

function fmtPct(pct: number | null): string {
  if (pct == null) return '—';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(0)}%`;
}

function fmtValue(v: number, unit: 'count' | 'won'): string {
  if (unit === 'won') {
    if (v >= 1e8) return `${(v / 1e8).toFixed(1)}억`;
    if (v >= 1e4) return `${Math.round(v / 1e4).toLocaleString('ko-KR')}만`;
    return v.toLocaleString('ko-KR');
  }
  return Math.round(v).toLocaleString('ko-KR');
}

/** 마지막 수집일이 오래됐으면 '지표 하락'이 아니라 '수집 중단'이다 — 그 구분이 오탐을 막는다. */
function staleDays(dateKey: string | null): number | null {
  if (!dateKey) return null;
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
  const a = Date.parse(`${dateKey}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

const th: CSSProperties = {
  padding: '8px 10px', fontSize: 11, fontWeight: 800, color: 'var(--text-muted)',
  textAlign: 'center', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)',
};
const td: CSSProperties = { padding: 0, borderBottom: '1px solid var(--border)', textAlign: 'center' };

export default function AdminStatsOverview() {
  const [rows, setRows] = useState<OverviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<MetricKey | 'worst'>('worst');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/stats/overview', { credentials: 'include' });
      const data = (await res.json()) as { rows?: OverviewRow[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? '불러오지 못했습니다.');
      setRows(data.rows ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '불러오지 못했습니다.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const sorted = useMemo(() => {
    const worstOf = (r: OverviewRow) =>
      Math.min(
        ...COLUMNS.map((c) => r.metrics[c.key].changePct).filter((p): p is number => p != null),
        0,
      );
    const list = [...rows];
    if (sortBy === 'worst') {
      // 가장 나쁜 지표 순 — 신규환자를 앞세운다(마케팅 성과의 종착점).
      list.sort((a, b) => {
        const an = a.metrics.newPatients.changePct ?? 0;
        const bn = b.metrics.newPatients.changePct ?? 0;
        if (an !== bn) return an - bn;
        return worstOf(a) - worstOf(b);
      });
    } else {
      list.sort((a, b) => (a.metrics[sortBy].changePct ?? 0) - (b.metrics[sortBy].changePct ?? 0));
    }
    return list;
  }, [rows, sortBy]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>전체 현황</h2>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          최근 4주 vs 직전 4주 · 각 병원을 자기 과거와만 비교합니다(병원 간 비교 아님)
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>정렬</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as MetricKey | 'worst')}
            style={{ padding: '4px 8px', fontSize: 11, borderRadius: 6, border: '1px solid var(--border-strong)', background: '#fff' }}
          >
            <option value="worst">악화 순 (신규환자 우선)</option>
            {COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.label} 낮은 순</option>)}
          </select>
          <button type="button" className="adminLegacySmallBtn" onClick={() => void load()} disabled={loading}>
            {loading ? '불러오는 중…' : '새로고침'}
          </button>
        </div>
      </div>

      {error ? (
        <div style={{ padding: 12, border: '1px solid var(--danger)', borderRadius: 8, background: 'var(--danger-subtle)', color: 'var(--danger)', fontSize: 14 }}>
          {error}
        </div>
      ) : null}

      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10, background: '#fff' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left', position: 'sticky', left: 0, background: '#fff', zIndex: 1 }}>병원</th>
              {COLUMNS.map((c) => <th key={c.key} style={th}>{c.label}</th>)}
              <th style={th}>신호</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.hospitalId}>
                <td style={{ ...td, textAlign: 'left', padding: '8px 10px', position: 'sticky', left: 0, background: '#fff', zIndex: 1 }}>
                  <Link
                    href={`/admin/performance/${r.hospitalId}/patients`}
                    style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', textDecoration: 'none' }}
                  >
                    {r.hospitalName}
                  </Link>
                </td>

                {COLUMNS.map((c) => {
                  const m = r.metrics[c.key];
                  const color = cellColor(m.changePct);
                  const fresh =
                    c.key === 'placeInflow' ? r.freshness.place
                      : c.key === 'blogViews' ? r.freshness.blog
                        : c.key === 'adClicks' ? r.freshness.ads
                          : r.freshness.management;
                  const stale = staleDays(fresh);
                  // 최근 4주 안에 데이터가 한 건도 없으면 '하락'이 아니라 '수집 중단'이다(변화율을 보여주면 오해를 부른다).
                  // 들어오긴 했는데 좀 밀렸으면(2주 이상) 값은 보여주되 ⚠ 로 경고만 — 경영통계는 병원 제출이라 며칠씩 늦는다.
                  const noData = m.current === 0 && m.previous === 0;
                  const isStale = fresh == null || (stale != null && stale > 28) || noData;
                  const lagging = !isStale && stale != null && stale > 14;
                  return (
                    <td key={c.key} style={td}>
                      <Link
                        href={`/admin/performance/${r.hospitalId}/${c.tab}`}
                        title={`${fmtValue(m.previous, c.unit)} → ${fmtValue(m.current, c.unit)}${fresh ? ` · 최근 수집 ${fresh}` : ' · 수집 기록 없음'}`}
                        style={{
                          display: 'block', padding: '10px 8px', textDecoration: 'none',
                          background: isStale ? 'var(--bg-subtle)' : color.bg,
                          color: isStale ? 'var(--text-muted)' : color.fg,
                        }}
                      >
                        <div style={{ fontSize: 14, fontWeight: 800 }}>
                          {isStale ? '수집 없음' : `${lagging ? '⚠ ' : ''}${fmtPct(m.changePct)}`}
                        </div>
                        <div style={{ fontSize: 11, opacity: 0.75 }}>
                          {isStale ? (stale != null ? `${stale}일 전` : '—') : fmtValue(m.current, c.unit)}
                        </div>
                      </Link>
                    </td>
                  );
                })}

                <td style={{ ...td, padding: '8px 10px' }}>
                  <div style={{ display: 'flex', gap: 4, justifyContent: 'center', flexWrap: 'wrap' }}>
                    {r.rankDrops > 0 ? (
                      <Link
                        href={`/admin/performance/keywords?hospitalId=${r.hospitalId}`}
                        style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: '#fee2e2', color: '#b91c1c', textDecoration: 'none' }}
                      >
                        순위 하락 {r.rankDrops}
                      </Link>
                    ) : null}
                    {r.newNegativeReviews > 0 ? (
                      <Link
                        href={`/admin/performance/${r.hospitalId}/place`}
                        style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: '#fef3c7', color: '#b45309', textDecoration: 'none' }}
                      >
                        부정 리뷰 {r.newNegativeReviews}
                      </Link>
                    ) : null}
                    {r.rankDrops === 0 && r.newNegativeReviews === 0 ? (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>—</span>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
            {!loading && sorted.length === 0 ? (
              <tr><td colSpan={COLUMNS.length + 2} style={{ ...td, padding: 30, color: 'var(--text-muted)', fontSize: 14 }}>표시할 병원이 없습니다.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <p style={{ margin: '10px 2px 0', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
        칸을 누르면 그 병원의 해당 지표 탭으로 이동합니다. 회색 &apos;수집 없음&apos;은 지표가 떨어진 게 아니라
        최근 4주 데이터가 아예 없는 것입니다(경영통계 미제출·수집 실패). ⚠ 는 데이터가 2주 이상 밀린 것이라 값이 과소평가돼 있을 수 있습니다.
        직전 4주 값이 0이면 변화율을 계산하지 않습니다.
      </p>
    </div>
  );
}
