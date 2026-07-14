'use client';

import { useState, type CSSProperties } from 'react';

type ChartGroup = {
  dateTime: string;
  bodyText: string;
  planText: string;
  planDetected: boolean;
  lineCount: number;
};

type LabItem = {
  itemName: string;
  valueText: string;
  unit: string | null;
  referenceRange: string | null;
  flag: string;
  page: number;
};

type BucketDebugData = {
  run: { chartType: string | null } | null;
  chartBodyByDate: ChartGroup[];
  bucketLines: { chartBody: string[]; lab: string[]; basicInfo: string[]; vitals: string[] };
  labItems: LabItem[];
};

const FLAG_COLOR: Record<string, string> = {
  high: 'var(--danger)',
  low: 'var(--accent)',
  normal: 'var(--success)',
  unknown: 'var(--text-muted)',
};

const FLAG_BG: Record<string, string> = {
  high: 'var(--danger-subtle)',
  low: 'var(--accent-subtle)',
  normal: 'var(--success-subtle)',
  unknown: 'var(--bg-subtle)',
};

const sectionStyle: CSSProperties = {
  border: '1px solid var(--border)',
  background: '#fff',
  borderRadius: 6,
  overflow: 'hidden',
};

const summaryStyle: CSSProperties = {
  cursor: 'pointer',
  listStyle: 'none',
  padding: '9px 14px',
  fontSize: 14,
  fontWeight: 700,
  color: 'var(--text-secondary)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  flexWrap: 'wrap',
  userSelect: 'none',
  background: 'var(--bg-subtle)',
  borderBottom: '1px solid var(--border)',
  letterSpacing: '0.01em',
};

type Tab = 'chartBody' | 'basicInfo' | 'lab' | 'vitals' | 'labItems';

export function BucketDebugPanel({ runId }: { runId: string }) {
  const [data, setData] = useState<BucketDebugData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('chartBody');

  async function load() {
    if (loaded) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/debug/bucket-debug?runId=${encodeURIComponent(runId)}`, { credentials: 'include' });
      const json = await res.json() as BucketDebugData & { error?: string };
      if (json.error) throw new Error(json.error);
      setData(json);
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const isPlusVet = data?.run?.chartType === 'plusvet';

  const TABS: { key: Tab; label: string; count?: number }[] = [
    { key: 'chartBody', label: '차트 본문 (날짜별)', count: data?.chartBodyByDate.length },
    { key: 'basicInfo', label: '기본정보 버킷', count: data?.bucketLines.basicInfo.length },
    { key: 'lab', label: '검사 버킷 raw', count: data?.bucketLines.lab.length },
    { key: 'vitals', label: '바이탈 버킷', count: data?.bucketLines.vitals.length },
    { key: 'labItems', label: '추출 검사항목', count: data?.labItems.length },
  ];

  return (
    <details
      style={{ ...sectionStyle, gridColumn: '1 / -1' }}
      onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) void load(); }}
    >
      <summary style={summaryStyle}>
        <span>버킷 디버그</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>클릭해서 펼치기</span>
      </summary>

      <div style={{ padding: '12px 14px' }}>
        {loading && <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: 0 }}>로드 중…</p>}
        {error && <p style={{ fontSize: 14, color: 'var(--danger)', margin: 0 }}>오류: {error}</p>}

        {data && (
          <>
            {/* 차트 종류 배지 */}
            {isPlusVet && (
              <div style={{ marginBottom: 10, fontSize: 14, color: 'var(--accent)', background: 'var(--accent-subtle)', border: '1px solid var(--accent-subtle)', borderRadius: 6, padding: '5px 10px' }}>
                PlusVet — Subjective → bodyText (파란색) · Plan → planText (초록색) · Objective 버려짐
              </div>
            )}

            {/* 탭 바 */}
            <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--border)', marginBottom: 12 }}>
              {TABS.map(({ key, label, count }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveTab(key)}
                  style={{ padding: '6px 14px', border: 'none', borderBottom: activeTab === key ? '2px solid var(--accent)' : '2px solid transparent', marginBottom: -2, background: 'none', cursor: 'pointer', fontSize: 14, fontFamily: 'sans-serif', fontWeight: activeTab === key ? 700 : 400, color: activeTab === key ? 'var(--accent)' : 'var(--text-secondary)' }}
                >
                  {label}
                  {count !== undefined && (
                    <span style={{ marginLeft: 4, background: 'var(--border)', borderRadius: 10, padding: '1px 5px', fontSize: 11 }}>{count}</span>
                  )}
                </button>
              ))}
            </div>

            {/* 차트 본문 탭 */}
            {activeTab === 'chartBody' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {data.chartBodyByDate.length === 0 && (
                  <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: 0 }}>날짜별 그룹 없음</p>
                )}
                {data.chartBodyByDate.map((g) => {
                  const bodyLines = g.bodyText ? g.bodyText.split('\n').filter(Boolean) : [];
                  const planLines = g.planText ? g.planText.split('\n').filter(Boolean) : [];
                  return (
                    <details key={g.dateTime} style={{ border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                      <summary style={{ padding: '6px 10px', fontSize: 14, fontWeight: 700, color: 'var(--text-secondary)', cursor: 'pointer', listStyle: 'none', background: 'var(--bg-subtle)', display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span>{g.dateTime}</span>
                        <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>{g.lineCount}줄</span>
                        {g.planDetected && <span style={{ fontSize: 11, background: 'var(--success-subtle)', color: 'var(--success)', border: '1px solid var(--success-subtle)', borderRadius: 10, padding: '1px 6px' }}>Plan 감지</span>}
                        {!g.planDetected && isPlusVet && <span style={{ fontSize: 11, background: 'var(--warning-subtle)', color: 'var(--warning)', border: '1px solid var(--warning-subtle)', borderRadius: 10, padding: '1px 6px' }}>Plan 없음</span>}
                      </summary>
                      <div style={{ padding: '8px 10px', display: 'grid', gridTemplateColumns: planLines.length > 0 ? '1fr 1fr' : '1fr', gap: 8 }}>
                        <div>
                          {isPlusVet && <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', marginBottom: 4 }}>Subjective (bodyText)</div>}
                          <pre style={{ margin: 0, fontSize: 11, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: isPlusVet ? 'var(--accent-subtle)' : 'var(--bg-subtle)', padding: '6px 8px', borderRadius: 4, maxHeight: 300, overflowY: 'auto' }}>
                            {bodyLines.join('\n') || '(비어 있음)'}
                          </pre>
                        </div>
                        {planLines.length > 0 && (
                          <div>
                            {isPlusVet && <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--success)', marginBottom: 4 }}>Plan (planText)</div>}
                            <pre style={{ margin: 0, fontSize: 11, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: 'var(--success-subtle)', padding: '6px 8px', borderRadius: 4, maxHeight: 300, overflowY: 'auto' }}>
                              {planLines.join('\n')}
                            </pre>
                          </div>
                        )}
                      </div>
                    </details>
                  );
                })}
              </div>
            )}

            {/* 기본정보 버킷 탭 */}
            {activeTab === 'basicInfo' && (
              <div>
                {data.bucketLines.basicInfo.length === 0 ? (
                  <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: 0 }}>기본정보 버킷이 비어있습니다.</p>
                ) : (
                  <pre style={{ margin: 0, padding: '8px 10px', fontSize: 11, lineHeight: 1.7, background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 500, overflowY: 'auto' }}>
                    {data.bucketLines.basicInfo.map((line, i) => (
                      <span key={i} style={{ display: 'block', borderBottom: '1px solid var(--bg-subtle)', paddingBottom: 1 }}>{line}</span>
                    ))}
                  </pre>
                )}
              </div>
            )}

            {/* 검사 버킷 raw 탭 */}
            {activeTab === 'lab' && (
              <div>
                {data.bucketLines.lab.length === 0 ? (
                  <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: 0 }}>lab 버킷 비어있음 — 버케팅 규칙이 검사 섹션을 찾지 못했을 수 있습니다.</p>
                ) : (
                  <pre style={{ margin: 0, padding: '8px 10px', fontSize: 11, lineHeight: 1.7, background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 500, overflowY: 'auto' }}>
                    {data.bucketLines.lab.map((line, i) => (
                      <span key={i} style={{ display: 'block', borderBottom: '1px solid var(--bg-subtle)', paddingBottom: 1 }}>{line}</span>
                    ))}
                  </pre>
                )}
              </div>
            )}

            {/* 바이탈 버킷 탭 */}
            {activeTab === 'vitals' && (
              <div>
                {data.bucketLines.vitals.length === 0 ? (
                  <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: 0 }}>바이탈 버킷이 비어있습니다 — 버케팅 규칙이 바이탈 섹션을 찾지 못했을 수 있습니다.</p>
                ) : (
                  <pre style={{ margin: 0, padding: '8px 10px', fontSize: 11, lineHeight: 1.7, background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 500, overflowY: 'auto' }}>
                    {data.bucketLines.vitals.map((line, i) => (
                      <span key={i} style={{ display: 'block', borderBottom: '1px solid var(--bg-subtle)', paddingBottom: 1 }}>{line}</span>
                    ))}
                  </pre>
                )}
              </div>
            )}

            {/* 추출 검사항목 탭 */}
            {activeTab === 'labItems' && (
              <div>
                {data.labItems.length === 0 ? (
                  <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: 0 }}>추출된 검사항목 없음</p>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                      <thead>
                        <tr style={{ background: 'var(--bg-subtle)' }}>
                          {['항목명', '결과값', '단위', '참고치', '플래그', 'p'].map((h) => (
                            <th key={h} style={{ padding: '5px 8px', textAlign: 'left', fontWeight: 700, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', fontFamily: 'sans-serif' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.labItems.map((item, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid var(--bg-subtle)' }}>
                            <td style={{ padding: '4px 8px', fontWeight: 600 }}>{item.itemName}</td>
                            <td style={{ padding: '4px 8px', color: FLAG_COLOR[item.flag] ?? 'var(--text)', fontWeight: 600 }}>{item.valueText}</td>
                            <td style={{ padding: '4px 8px', color: 'var(--text-muted)' }}>{item.unit ?? '—'}</td>
                            <td style={{ padding: '4px 8px', color: 'var(--text-muted)' }}>{item.referenceRange ?? '—'}</td>
                            <td style={{ padding: '4px 8px' }}>
                              <span style={{ padding: '1px 6px', borderRadius: 10, fontSize: 11, fontWeight: 700, fontFamily: 'sans-serif', background: FLAG_BG[item.flag] ?? 'var(--bg-subtle)', color: FLAG_COLOR[item.flag] ?? 'var(--text-muted)' }}>
                                {item.flag}
                              </span>
                            </td>
                            <td style={{ padding: '4px 8px', color: 'var(--text-muted)' }}>{item.page}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </details>
  );
}
