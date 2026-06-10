'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const TOKEN_VALUE_USD = 0.01; // 1토큰 = $0.01 (환산 표시)
const KRW_PER_USD = 1380;

type HospitalRow = {
  hospitalId: string | null;
  hospitalName: string;
  tokenBalance: number;
  costUsd: number;
  calls: number;
  lastUsed: string | null;
};
type DailyRow = { date: string; feature: string; costUsd: number };
type UsageResponse = {
  days: number;
  totalUsd: number;
  hospitals: HospitalRow[];
  daily: DailyRow[];
  featureKeys: string[];
  note?: string;
  error?: string;
};

const DAY_OPTIONS = [7, 30, 90];

// 기능 코드 → 한글 라벨 + 색
const FEATURE_LABEL: Record<string, string> = {
  extract: '추출',
  ocr: 'OCR',
  blog_causal: '블로그·인과',
  blog_outline: '블로그·아웃라인',
  blog_post: '블로그·글',
  health_checkup: '건강검진',
  disease_intro: '질환소개',
  image_placement: '이미지배치',
  image_analysis: '이미지분석',
  assessment: 'AI평가',
};
const PALETTE = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#64748b'];
const featureLabel = (f: string) => FEATURE_LABEL[f] ?? f;

const tok = (usd: number) => usd / TOKEN_VALUE_USD;
const fmtTok = (v: number) => (v >= 100 ? Math.round(v).toLocaleString() : v.toFixed(1));
const usd = (v: number) => `$${v.toFixed(v < 1 ? 4 : 2)}`;
const krw = (v: number) => `₩${Math.round(v * KRW_PER_USD).toLocaleString()}`;
const num = (v: number) => v.toLocaleString();

export default function AdminUsageDashboard() {
  const [days, setDays] = useState(30);
  const [selected, setSelected] = useState<string | null>(null);
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (d: number, hospitalId: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ days: String(d) });
      if (hospitalId) qs.set('hospitalId', hospitalId);
      const res = await fetch(`/api/admin/usage?${qs.toString()}`, { credentials: 'include' });
      const json = (await res.json()) as UsageResponse;
      if (!res.ok) throw new Error(json.error || '불러오기 실패');
      setData(json);
      // 선택이 없으면 비용 1위 병원 자동 선택
      if (!hospitalId && json.hospitals.length > 0) {
        setSelected(json.hospitals[0].hospitalId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '불러오기 실패');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(days, selected);
  }, [days, selected, load]);

  const grant = useCallback(
    async (hospitalId: string, name: string, current: number) => {
      const input = window.prompt(`"${name}" 에 지급할 토큰 수 (음수면 차감). 현재 잔액 ${current.toLocaleString()}`, '1000');
      if (input == null) return;
      const tokens = Math.trunc(Number(input));
      if (!Number.isFinite(tokens) || tokens === 0) return;
      try {
        const res = await fetch('/api/admin/usage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ hospitalId, tokens }),
        });
        const json = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(json.error || '지급 실패');
        await load(days, selected);
      } catch (e) {
        window.alert(e instanceof Error ? e.message : '지급 실패');
      }
    },
    [days, selected, load],
  );

  // daily → 날짜별 스택 데이터(기능별 토큰)
  const chartData = useMemo(() => {
    const byDate = new Map<string, Record<string, number | string>>();
    for (const r of data?.daily ?? []) {
      const row = byDate.get(r.date) ?? { date: r.date };
      row[r.feature] = ((row[r.feature] as number) ?? 0) + tok(r.costUsd);
      byDate.set(r.date, row);
    }
    return [...byDate.values()].sort((a, b) => (String(a.date) < String(b.date) ? -1 : 1));
  }, [data]);

  const featureKeys = data?.featureKeys ?? [];
  const selectedHospital = (data?.hospitals ?? []).find((h) => h.hospitalId === selected) ?? null;
  const anyZero = (data?.hospitals ?? []).some((h) => h.tokenBalance <= 0);

  return (
    <div style={{ padding: '4px 2px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>사용량</h1>
          <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '4px 0 0' }}>
            병원을 고르면 날짜별·기능별 토큰 사용량을 막대그래프로 봅니다. (출처 무관, 그 병원 작업이면 합산)
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {DAY_OPTIONS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              style={{
                padding: '6px 12px',
                fontSize: 12.5,
                fontWeight: 700,
                borderRadius: 8,
                cursor: 'pointer',
                border: `1px solid ${days === d ? 'var(--accent)' : 'var(--border-strong)'}`,
                background: days === d ? 'var(--accent-subtle)' : '#fff',
                color: days === d ? 'var(--accent)' : 'var(--text-secondary)',
              }}
            >
              최근 {d}일
            </button>
          ))}
        </div>
      </div>

      {data?.note ? (
        <div style={banner('var(--warning-subtle, #fef9c3)', 'var(--text-secondary)')}>{data.note}</div>
      ) : null}
      {error ? <div style={banner('var(--danger-subtle)', 'var(--danger)')}>{error}</div> : null}
      {anyZero ? (
        <div style={banner('var(--warning-subtle, #fef9c3)', 'var(--text-secondary)')}>
          잔액이 0 이하인 병원은 AI 작업이 차단됩니다. 아래 목록의 <b>지급</b> 으로 충전하세요.
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 320px) 1fr', gap: 14, alignItems: 'start' }}>
        {/* 병원 목록 */}
        <div style={cardBox}>
          <div style={{ ...sectionTitle, padding: '8px 12px 4px' }}>병원 ({data?.hospitals.length ?? 0})</div>
          <div style={{ maxHeight: 560, overflowY: 'auto' }}>
            {(data?.hospitals ?? []).map((h) => {
              const active = h.hospitalId === selected;
              return (
                <div
                  key={h.hospitalId ?? 'none'}
                  onClick={() => h.hospitalId && setSelected(h.hospitalId)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    padding: '9px 12px',
                    cursor: h.hospitalId ? 'pointer' : 'default',
                    borderTop: '1px solid var(--border)',
                    background: active ? 'var(--accent-subtle)' : 'transparent',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: active ? 700 : 500, color: active ? 'var(--accent)' : 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {h.hospitalName}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      잔액 <span style={{ color: h.tokenBalance <= 0 ? 'var(--danger)' : 'var(--text-secondary)', fontWeight: 700 }}>{num(h.tokenBalance)}</span> · {usd(h.costUsd)}
                    </div>
                  </div>
                  {h.hospitalId ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void grant(h.hospitalId as string, h.hospitalName, h.tokenBalance);
                      }}
                      style={{ flexShrink: 0, padding: '3px 9px', fontSize: 11, fontWeight: 700, borderRadius: 6, cursor: 'pointer', border: '1px solid var(--accent)', background: '#fff', color: 'var(--accent)' }}
                    >
                      지급
                    </button>
                  ) : null}
                </div>
              );
            })}
            {(data?.hospitals.length ?? 0) === 0 && !loading ? (
              <div style={{ padding: 14, fontSize: 13, color: 'var(--text-muted)' }}>병원이 없습니다.</div>
            ) : null}
          </div>
        </div>

        {/* 선택 병원 그래프 */}
        <div style={{ ...cardBox, padding: '12px 14px', minHeight: 420 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 15, fontWeight: 800 }}>{selectedHospital?.hospitalName ?? '병원을 선택하세요'}</div>
            {selectedHospital ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                잔액 <b style={{ color: selectedHospital.tokenBalance <= 0 ? 'var(--danger)' : 'var(--text)' }}>{num(selectedHospital.tokenBalance)}</b> 토큰
                {' · '}최근 {days}일 {usd(selectedHospital.costUsd)} (≈{krw(selectedHospital.costUsd)})
              </div>
            ) : null}
          </div>

          {chartData.length === 0 ? (
            <div style={{ height: 360, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              {loading ? '불러오는 중…' : '이 기간 사용 내역이 없습니다.'}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={380}>
              <BarChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d: string) => d.slice(5)} />
                <YAxis tick={{ fontSize: 11 }} width={44} label={{ value: '토큰', angle: -90, position: 'insideLeft', fontSize: 11 }} />
                <Tooltip
                  formatter={(value) => `${fmtTok(Number(value))} 토큰`}
                  contentStyle={{ fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {featureKeys.map((fk, i) => (
                  <Bar key={fk} dataKey={fk} stackId="u" fill={PALETTE[i % PALETTE.length]} name={featureLabel(fk)} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}

function banner(bg: string, color: string): React.CSSProperties {
  return { padding: 12, marginBottom: 12, fontSize: 12.5, background: bg, borderRadius: 8, color };
}
const cardBox: React.CSSProperties = { background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: 0, overflow: 'hidden' };
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' };
