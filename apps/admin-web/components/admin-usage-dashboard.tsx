'use client';

import { useCallback, useEffect, useState } from 'react';

// 참고용 표시 환율(과금 아님 — 정확한 청구는 별도 정책에서). 필요 시 조정.
const KRW_PER_USD = 1380;

type HospitalRow = {
  hospitalId: string | null;
  hospitalName: string;
  tokenBalance: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  calls: number;
  lastUsed: string | null;
};
type FeatureRow = { feature: string; provider: string; costUsd: number; calls: number };
type UsageResponse = {
  days: number;
  totalUsd: number;
  totalCalls: number;
  hospitals: HospitalRow[];
  features: FeatureRow[];
  note?: string;
  error?: string;
};

const DAY_OPTIONS = [7, 30, 90];

const usd = (v: number) => `$${v.toFixed(v < 1 ? 4 : 2)}`;
const krw = (v: number) => `₩${Math.round(v * KRW_PER_USD).toLocaleString()}`;
const num = (v: number) => v.toLocaleString();
const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '-';

export default function AdminUsageDashboard() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (d: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/usage?days=${d}`, { credentials: 'include' });
      const json = (await res.json()) as UsageResponse;
      if (!res.ok) throw new Error(json.error || '불러오기 실패');
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : '불러오기 실패');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(days);
  }, [days, load]);

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
        const json = (await res.json()) as { error?: string; balanceAfter?: number };
        if (!res.ok) throw new Error(json.error || '지급 실패');
        await load(days);
      } catch (e) {
        window.alert(e instanceof Error ? e.message : '지급 실패');
      }
    },
    [days, load],
  );

  const anyZero = (data?.hospitals ?? []).some((h) => h.tokenBalance <= 0);

  return (
    <div style={{ padding: '4px 2px', maxWidth: 1100 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 14,
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>사용량</h1>
          <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '4px 0 0' }}>
            병원별 AI(LLM) 사용량·비용. 출처(병원/관리자)와 무관하게 그 병원 작업이면 합산됩니다.
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
        <div
          style={{
            padding: 12,
            marginBottom: 12,
            fontSize: 13,
            background: 'var(--warning-subtle, #fef9c3)',
            borderRadius: 8,
            color: 'var(--text-secondary)',
          }}
        >
          {data.note}
        </div>
      ) : null}
      {error ? (
        <div
          style={{
            padding: 12,
            marginBottom: 12,
            fontSize: 13,
            background: 'var(--danger-subtle)',
            borderRadius: 8,
            color: 'var(--danger)',
          }}
        >
          {error}
        </div>
      ) : null}
      {anyZero ? (
        <div
          style={{
            padding: 12,
            marginBottom: 12,
            fontSize: 12.5,
            background: 'var(--warning-subtle, #fef9c3)',
            borderRadius: 8,
            color: 'var(--text-secondary)',
          }}
        >
          잔액이 0 이하인 병원은 AI 작업이 차단됩니다(생성·추출·분석 시 "토큰 부족"). 아래 표의 <b>지급</b> 버튼으로 충전하세요.
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <SummaryCard
          label={`총 비용 (최근 ${days}일)`}
          value={usd(data?.totalUsd ?? 0)}
          sub={`≈ ${krw(data?.totalUsd ?? 0)} (참고환율 ${KRW_PER_USD})`}
        />
        <SummaryCard label="총 호출 수" value={num(data?.totalCalls ?? 0)} sub={`${data?.hospitals.length ?? 0}개 병원`} />
      </div>

      <SectionTitle>병원별</SectionTitle>
      <div style={cardBox}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <Th>병원</Th>
              <Th right>토큰 잔액</Th>
              <Th right>호출</Th>
              <Th right>비용(USD)</Th>
              <Th right>≈ 원화</Th>
              <Th right>최근 사용</Th>
              <Th right>지급</Th>
            </tr>
          </thead>
          <tbody>
            {loading && !data ? (
              <tr>
                <Td colSpan={7} muted>
                  불러오는 중…
                </Td>
              </tr>
            ) : (data?.hospitals.length ?? 0) === 0 ? (
              <tr>
                <Td colSpan={7} muted>
                  데이터가 없습니다.
                </Td>
              </tr>
            ) : (
              data!.hospitals.map((h) => (
                <tr key={h.hospitalId ?? 'none'} style={{ borderTop: '1px solid var(--border)' }}>
                  <Td>{h.hospitalName}</Td>
                  <Td right strong>
                    <span style={{ color: h.tokenBalance <= 0 ? 'var(--danger)' : 'var(--text)' }}>{num(h.tokenBalance)}</span>
                  </Td>
                  <Td right>{num(h.calls)}</Td>
                  <Td right>{usd(h.costUsd)}</Td>
                  <Td right>{krw(h.costUsd)}</Td>
                  <Td right muted>
                    {fmtDate(h.lastUsed)}
                  </Td>
                  <Td right>
                    {h.hospitalId ? (
                      <button
                        type="button"
                        onClick={() => grant(h.hospitalId as string, h.hospitalName, h.tokenBalance)}
                        style={{
                          padding: '3px 10px',
                          fontSize: 11.5,
                          fontWeight: 700,
                          borderRadius: 6,
                          cursor: 'pointer',
                          border: '1px solid var(--accent)',
                          background: 'var(--accent-subtle)',
                          color: 'var(--accent)',
                        }}
                      >
                        지급
                      </button>
                    ) : null}
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <SectionTitle>기능 · 프로바이더별</SectionTitle>
      <div style={cardBox}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <Th>기능</Th>
              <Th>프로바이더</Th>
              <Th right>호출</Th>
              <Th right>비용(USD)</Th>
            </tr>
          </thead>
          <tbody>
            {(data?.features.length ?? 0) === 0 ? (
              <tr>
                <Td colSpan={4} muted>
                  데이터가 없습니다.
                </Td>
              </tr>
            ) : (
              data!.features.map((f, i) => (
                <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                  <Td>{f.feature}</Td>
                  <Td>{f.provider}</Td>
                  <Td right>{num(f.calls)}</Td>
                  <Td right strong>
                    {usd(f.costUsd)}
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ ...cardBox, flex: '1 1 240px', minWidth: 220, padding: '12px 14px' }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{value}</div>
      {sub ? <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div> : null}
    </div>
  );
}
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', margin: '18px 2px 8px' }}>{children}</div>
  );
}
function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      style={{
        textAlign: right ? 'right' : 'left',
        padding: '9px 12px',
        fontSize: 11.5,
        fontWeight: 700,
        color: 'var(--text-muted)',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </th>
  );
}
function Td({
  children,
  right,
  muted,
  strong,
  colSpan,
}: {
  children: React.ReactNode;
  right?: boolean;
  muted?: boolean;
  strong?: boolean;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      style={{
        textAlign: right ? 'right' : 'left',
        padding: '9px 12px',
        fontSize: 13,
        color: muted ? 'var(--text-muted)' : 'var(--text)',
        fontWeight: strong ? 700 : 400,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </td>
  );
}

const cardBox: React.CSSProperties = {
  background: '#fff',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: '6px 4px',
};
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse' };
