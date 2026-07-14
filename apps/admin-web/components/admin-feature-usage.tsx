'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type HospitalRow = {
  hospitalId: string;
  hospitalName: string;
  address: string | null;
  caseBlog: number;
  healthReport: number;
  intake: number;
  preConsult: number;
  tokensUsed: number;
  total: number;
  lastUsed: string | null;
};
type Totals = { caseBlog: number; healthReport: number; intake: number; preConsult: number; tokensUsed: number; total: number };
type Response = {
  days: number | 'all';
  totals: Totals;
  hospitals: HospitalRow[];
  note?: string;
  error?: string;
};

// 기간 옵션 — 토큰 관리와 동일 톤 + '전체'.
const PERIODS: { key: string; label: string }[] = [
  { key: '7', label: '최근 7일' },
  { key: '30', label: '최근 30일' },
  { key: '90', label: '최근 90일' },
  { key: 'all', label: '전체' },
];

// 4개 기능 컬럼 정의 (라벨·색상). 색은 CSS 변수 폴백 포함.
const FEATURES = [
  { key: 'caseBlog', label: '진료케이스', color: '#7c3aed' },
  { key: 'healthReport', label: '건강검진', color: '#dc2626' },
  { key: 'intake', label: '초진 접수', color: '#0891b2' },
  { key: 'preConsult', label: '사전문진', color: '#ca8a04' },
] as const;

const num = (v: number) => v.toLocaleString();
const shortAddress = (addr: string | null) =>
  (addr ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join(' ');
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

export default function AdminFeatureUsage() {
  const [period, setPeriod] = useState('30');
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async (p: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/feature-usage?days=${encodeURIComponent(p)}`, { credentials: 'include' });
      const json = (await res.json()) as Response;
      if (!res.ok) throw new Error(json.error || '불러오기 실패');
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : '불러오기 실패');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(period);
  }, [period, load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = data?.hospitals ?? [];
    if (!q) return all;
    return all.filter((h) => `${h.hospitalName} ${h.address ?? ''}`.toLowerCase().includes(q));
  }, [data, query]);

  // 사용 이력이 있는 병원만 우선 보여주고, 활동 없는 병원은 접어둠(토글).
  const [showZero, setShowZero] = useState(false);
  const isActive = (h: HospitalRow) => h.total > 0 || h.tokensUsed > 0;
  const visible = useMemo(() => (showZero ? filtered : filtered.filter(isActive)), [filtered, showZero]);
  const zeroCount = filtered.length - filtered.filter(isActive).length;

  const totals = data?.totals;

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto' }}>
      {/* 헤더 + 기간 */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)' }}>사용 현황</div>
          <div style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 3 }}>
            병원별 진료케이스·건강검진·초진 접수·사전문진 사용 건수
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPeriod(p.key)}
              style={{
                padding: '6px 12px',
                fontSize: 14,
                fontWeight: 700,
                borderRadius: 8,
                cursor: 'pointer',
                border: `1px solid ${period === p.key ? 'var(--accent)' : 'var(--border-strong)'}`,
                background: period === p.key ? 'var(--accent-subtle)' : '#fff',
                color: period === p.key ? 'var(--accent)' : 'var(--text-secondary)',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* 요약 타일 (전체 합계) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
        {FEATURES.map((f) => (
          <div key={f.key} style={tile}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: f.color, flexShrink: 0 }} />
              <span style={{ fontSize: 14, color: 'var(--text-secondary)', fontWeight: 600 }}>{f.label}</span>
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', marginTop: 6 }}>
              {loading ? '—' : num(totals?.[f.key] ?? 0)}
            </div>
          </div>
        ))}
        {/* 사용 토큰 합계 — 강조 타일 */}
        <div style={{ ...tile, borderColor: 'var(--accent)', background: 'var(--accent-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 14, color: 'var(--accent)', fontWeight: 700 }}>사용 토큰</span>
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--accent)', marginTop: 6 }}>
            {loading ? '—' : num(totals?.tokensUsed ?? 0)}
          </div>
        </div>
      </div>

      {/* 검색 + 0건 토글 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="병원명·주소 검색"
          aria-label="병원 검색"
          style={{ flex: 1, minWidth: 180, padding: '8px 12px', border: '1px solid var(--border-strong)', borderRadius: 8, outline: 'none', font: 'inherit', fontSize: 14 }}
          disabled={loading}
        />
        {zeroCount > 0 ? (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, color: 'var(--text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={showZero} onChange={(e) => setShowZero(e.target.checked)} />
            사용 없는 병원 {zeroCount}곳 보기
          </label>
        ) : null}
      </div>

      {data?.note ? <div style={banner('var(--warning-subtle, #fef9c3)', 'var(--text-secondary)')}>{data.note}</div> : null}
      {error ? <div style={banner('var(--danger-subtle)', 'var(--danger)')}>{error}</div> : null}

      {/* 병원별 테이블 */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--border-strong)' }}>
              <th style={{ ...th, textAlign: 'left' }}>병원</th>
              {FEATURES.map((f) => (
                <th key={f.key} style={{ ...th, textAlign: 'right' }}>{f.label}</th>
              ))}
              <th style={{ ...th, textAlign: 'right' }}>사용 토큰</th>
              <th style={{ ...th, textAlign: 'right', whiteSpace: 'nowrap' }}>최근 사용</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((h) => (
              <tr key={h.hospitalId} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ ...td, textAlign: 'left' }}>
                  <div style={{ fontWeight: 600, color: 'var(--text)' }}>{h.hospitalName}</div>
                  {shortAddress(h.address) ? (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{shortAddress(h.address)}</div>
                  ) : null}
                </td>
                <td style={{ ...td, textAlign: 'right' }}>{cell(h.caseBlog)}</td>
                <td style={{ ...td, textAlign: 'right' }}>{cell(h.healthReport)}</td>
                <td style={{ ...td, textAlign: 'right' }}>{cell(h.intake)}</td>
                <td style={{ ...td, textAlign: 'right' }}>{cell(h.preConsult)}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 800, color: h.tokensUsed > 0 ? 'var(--accent)' : 'var(--text-muted)' }}>{num(h.tokensUsed)}</td>
                <td style={{ ...td, textAlign: 'right', color: 'var(--text-muted)', fontSize: 11, whiteSpace: 'nowrap' }}>{fmtDate(h.lastUsed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && visible.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', fontSize: 14, color: 'var(--text-muted)' }}>
            {query.trim() ? '검색 결과 없음' : '해당 기간에 사용 기록이 없습니다.'}
          </div>
        ) : null}
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', fontSize: 14, color: 'var(--text-muted)' }}>불러오는 중…</div>
        ) : null}
      </div>
    </div>
  );
}

// 0건은 흐리게, 1건 이상은 진하게.
function cell(v: number) {
  return v > 0 ? (
    <span style={{ color: 'var(--text)', fontWeight: 600 }}>{num(v)}</span>
  ) : (
    <span style={{ color: 'var(--text-muted)' }}>0</span>
  );
}

const tile: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: '12px 14px',
  background: 'var(--bg)',
};
const th: React.CSSProperties = {
  padding: '10px 10px',
  fontSize: 14,
  fontWeight: 700,
  color: 'var(--text-secondary)',
  whiteSpace: 'nowrap',
};
const td: React.CSSProperties = {
  padding: '10px 10px',
  verticalAlign: 'top',
};

function banner(bg: string, color: string): React.CSSProperties {
  return { padding: 12, marginBottom: 12, fontSize: 14, background: bg, borderRadius: 8, color };
}
