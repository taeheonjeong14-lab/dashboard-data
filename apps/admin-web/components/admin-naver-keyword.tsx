'use client';

import { useCallback, useMemo, useState } from 'react';

type Row = {
  keyword: string;
  isHint: boolean;
  pcCount: number;
  pcUnder10: boolean;
  mobileCount: number;
  mobileUnder10: boolean;
  totalCount: number;
  compIdx: string;
  plAvgDepth: number;
  avgPcClick: number;
  avgMobileClick: number;
};
type Response = {
  account?: string;
  queried?: string[];
  dropped?: number;
  count?: number;
  rows?: Row[];
  error?: string;
  detail?: string;
};

const num = (v: number) => v.toLocaleString();
// "< 10" 대응 표기.
const fmtCount = (n: number, under10: boolean) => (under10 ? '10 미만' : num(n));

// 경쟁정도 배지 색.
const compColor: Record<string, { bg: string; fg: string }> = {
  높음: { bg: '#fee2e2', fg: '#b91c1c' },
  중간: { bg: '#fef3c7', fg: '#b45309' },
  낮음: { bg: '#dcfce7', fg: '#15803d' },
};

export default function AdminNaverKeyword() {
  const [input, setInput] = useState('');
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const search = useCallback(async () => {
    const keywords = input.trim();
    if (!keywords || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/naver-keyword', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ keywords }),
      });
      const json = (await res.json()) as Response;
      if (!res.ok) throw new Error(json.error || '조회 실패');
      setData(json);
      setFilter('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '조회 실패');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [input, loading]);

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    const q = filter.trim().toLowerCase();
    if (!q) return all;
    return all.filter((r) => r.keyword.toLowerCase().includes(q));
  }, [data, filter]);

  const hasRows = !!data && (data.rows?.length ?? 0) > 0;

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)' }}>네이버 검색량</div>
        <div style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 3 }}>
          키워드의 월간 PC·모바일 검색수를 네이버 검색광고 키워드도구로 조회합니다. 연관 키워드도 함께 나옵니다.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* 좌측: 입력 패널 */}
        <div style={{ flex: '0 0 320px', minWidth: 260, position: 'sticky', top: 16 }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void search();
            }}
            placeholder={'키워드 입력 (콤마 또는 줄바꿈으로 구분, 최대 5개)\n예: 강아지 예방접종, 고양이 중성화'}
            rows={5}
            style={{
              width: '100%',
              padding: '10px 12px',
              border: '1px solid var(--border-strong)',
              borderRadius: 8,
              outline: 'none',
              font: 'inherit',
              fontSize: 14,
              resize: 'vertical',
              boxSizing: 'border-box',
              background: '#fff',
              color: '#111',
            }}
            disabled={loading}
          />
          <button
            type="button"
            onClick={() => void search()}
            disabled={loading || !input.trim()}
            style={{
              width: '100%',
              marginTop: 8,
              padding: '11px 20px',
              fontSize: 14,
              fontWeight: 700,
              borderRadius: 8,
              cursor: loading || !input.trim() ? 'default' : 'pointer',
              border: 'none',
              background: loading || !input.trim() ? 'var(--text-muted)' : 'var(--accent)',
              color: '#fff',
              whiteSpace: 'nowrap',
            }}
          >
            {loading ? '조회 중…' : '검색량 조회'}
          </button>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
            키워드 내부 공백은 자동 제거됩니다. ⌘/Ctrl+Enter 로도 조회.
          </div>

          {error ? <div style={{ ...banner('var(--danger-subtle)', 'var(--danger)'), marginTop: 12, marginBottom: 0 }}>{error}</div> : null}
          {data?.dropped ? (
            <div style={{ ...banner('var(--warning-subtle, #fef9c3)', 'var(--text-secondary)'), marginTop: 12, marginBottom: 0 }}>
              한 번에 최대 5개까지만 조회됩니다. 입력한 키워드 중 {data.dropped}개는 제외했습니다.
            </div>
          ) : null}
        </div>

        {/* 우측: 결과 목록 */}
        <div style={{ flex: 1, minWidth: 320 }}>
          {hasRows ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                <input
                  type="search"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="결과 내 키워드 필터"
                  style={{ flex: 1, minWidth: 180, padding: '8px 12px', border: '1px solid var(--border-strong)', borderRadius: 8, outline: 'none', font: 'inherit', fontSize: 14, background: '#fff', color: '#111' }}
                />
                <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  {rows.length} / {data?.count}개 · 조회 계정 {data?.account}
                </span>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--border-strong)' }}>
                      <th style={{ ...th, textAlign: 'left' }}>키워드</th>
                      <th style={{ ...th, textAlign: 'right' }}>PC 검색수</th>
                      <th style={{ ...th, textAlign: 'right' }}>모바일 검색수</th>
                      <th style={{ ...th, textAlign: 'right' }}>합계</th>
                      <th style={{ ...th, textAlign: 'center' }}>경쟁정도</th>
                      <th style={{ ...th, textAlign: 'right', whiteSpace: 'nowrap' }}>노출광고수</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const cc = compColor[r.compIdx];
                      return (
                        <tr key={r.keyword} style={{ borderBottom: '1px solid var(--border)', background: r.isHint ? 'var(--accent-subtle)' : 'transparent' }}>
                          <td style={{ ...td, textAlign: 'left', fontWeight: r.isHint ? 700 : 500, color: 'var(--text)' }}>
                            {r.keyword}
                            {r.isHint ? <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: 'var(--accent)' }}>입력</span> : null}
                          </td>
                          <td style={{ ...td, textAlign: 'right' }}>{fmtCount(r.pcCount, r.pcUnder10)}</td>
                          <td style={{ ...td, textAlign: 'right' }}>{fmtCount(r.mobileCount, r.mobileUnder10)}</td>
                          <td style={{ ...td, textAlign: 'right', fontWeight: 800, color: 'var(--text)' }}>
                            {r.pcUnder10 || r.mobileUnder10 ? '~' : ''}{num(r.totalCount)}
                          </td>
                          <td style={{ ...td, textAlign: 'center' }}>
                            {r.compIdx ? (
                              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: cc?.bg ?? 'var(--border)', color: cc?.fg ?? 'var(--text-secondary)' }}>
                                {r.compIdx}
                              </span>
                            ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                          </td>
                          <td style={{ ...td, textAlign: 'right', color: 'var(--text-secondary)' }}>{num(r.plAvgDepth)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {rows.length === 0 ? (
                  <div style={{ padding: 24, textAlign: 'center', fontSize: 14, color: 'var(--text-muted)' }}>필터 결과 없음</div>
                ) : null}
              </div>
            </>
          ) : (
            <div style={emptyPanel}>
              {loading ? '조회 중…' : data ? '조회 결과가 없습니다.' : '왼쪽에 키워드를 입력하고 검색량을 조회하세요.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const emptyPanel: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 220,
  padding: 24,
  textAlign: 'center',
  fontSize: 14,
  color: 'var(--text-muted)',
  border: '1px dashed var(--border)',
  borderRadius: 10,
};
const th: React.CSSProperties = { padding: '10px 10px', fontSize: 14, fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '9px 10px', verticalAlign: 'middle' };
function banner(bg: string, color: string): React.CSSProperties {
  return { padding: 12, marginBottom: 12, fontSize: 14, background: bg, borderRadius: 8, color };
}
