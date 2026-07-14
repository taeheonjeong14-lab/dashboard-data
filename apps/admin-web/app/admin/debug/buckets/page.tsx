'use client';

import { useEffect, useState, useCallback } from 'react';

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

type LabDateGroup = {
  dateTime: string;
  items: Array<{ itemName: string; valueText: string; unit: string | null; flag: string }>;
};

type BucketDebugResult = {
  run: {
    id: string;
    createdAt: string;
    friendlyId: string | null;
    status: string;
    chartType: string | null;
    fileName: string | null;
  } | null;
  chartBodyByDate: ChartGroup[];
  bucketLines: {
    chartBody: string[];
    lab: string[];
    basicInfo: string[];
    vitals: string[];
  };
  labItems: LabItem[];
  labItemsByDate: LabDateGroup[];
  error?: string;
};

type Tab = 'chartBody' | 'lab' | 'labItems' | 'rawBuckets';

const FLAG_COLOR: Record<string, string> = {
  high: '#b91c1c',
  low: '#1d4ed8',
  normal: '#15803d',
  unknown: '#64748b',
};

function isSoapHeader(line: string) {
  const t = line.replace(/^p\d+:\s*/, '').trim();
  return /^(Subjective|Objective|Plan)$/i.test(t);
}

function soapHeaderType(line: string): 'Subjective' | 'Objective' | 'Plan' | null {
  const t = line.replace(/^p\d+:\s*/, '').trim();
  if (/^Subjective$/i.test(t)) return 'Subjective';
  if (/^Objective$/i.test(t)) return 'Objective';
  if (/^Plan$/i.test(t)) return 'Plan';
  return null;
}

const SOAP_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  Subjective: { bg: '#eff6ff', color: '#1d4ed8', label: 'S' },
  Objective: { bg: '#fef3c7', color: '#92400e', label: 'O' },
  Plan: { bg: '#f0fdf4', color: '#15803d', label: 'P' },
};

function ChartBodyGroup({ group, isPlusVet }: { group: ChartGroup; isPlusVet: boolean }) {
  const [open, setOpen] = useState(false);
  const bodyLines = group.bodyText ? group.bodyText.split('\n').filter(Boolean) : [];
  const planLines = group.planText ? group.planText.split('\n').filter(Boolean) : [];

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, overflow: 'hidden', marginBottom: 6 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{ width: '100%', textAlign: 'left', background: '#f8fafc', padding: '8px 12px', border: 'none', cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'center', fontSize: 13, fontFamily: 'monospace' }}
      >
        <span style={{ fontWeight: 700, color: '#0f172a' }}>{group.dateTime}</span>
        <span style={{ color: '#64748b' }}>{group.lineCount}줄</span>
        {group.planDetected && (
          <span style={{ background: '#f0fdf4', color: '#15803d', border: '1px solid #86efac', borderRadius: 4, padding: '1px 6px', fontSize: 11, fontWeight: 700 }}>Plan 감지</span>
        )}
        {!group.planDetected && isPlusVet && (
          <span style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', borderRadius: 4, padding: '1px 6px', fontSize: 11 }}>Plan 없음</span>
        )}
        <span style={{ marginLeft: 'auto', color: '#94a3b8' }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{ padding: '10px 12px', background: '#fff', borderTop: '1px solid #e2e8f0' }}>
          {isPlusVet ? (
            <div style={{ display: 'grid', gridTemplateColumns: planLines.length > 0 ? '1fr 1fr' : '1fr', gap: 10 }}>
              {/* bodyText */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#1d4ed8', marginBottom: 4, fontFamily: 'sans-serif' }}>
                  Subjective (bodyText) — {bodyLines.length}줄
                </div>
                <pre style={{ margin: 0, fontSize: 11, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: '#eff6ff', padding: '6px 8px', borderRadius: 4, maxHeight: 400, overflowY: 'auto' }}>
                  {bodyLines.join('\n') || '(비어 있음)'}
                </pre>
              </div>
              {/* planText */}
              {planLines.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#15803d', marginBottom: 4, fontFamily: 'sans-serif' }}>
                    Plan (planText) — {planLines.length}줄
                  </div>
                  <pre style={{ margin: 0, fontSize: 11, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: '#f0fdf4', padding: '6px 8px', borderRadius: 4, maxHeight: 400, overflowY: 'auto' }}>
                    {planLines.join('\n')}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 4, fontFamily: 'sans-serif' }}>bodyText — {bodyLines.length}줄</div>
              <pre style={{ margin: 0, fontSize: 11, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: '#f8fafc', padding: '6px 8px', borderRadius: 4, maxHeight: 300, overflowY: 'auto' }}>
                {bodyLines.join('\n') || '(비어 있음)'}
              </pre>
              {planLines.length > 0 && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#15803d', margin: '8px 0 4px', fontFamily: 'sans-serif' }}>planText — {planLines.length}줄</div>
                  <pre style={{ margin: 0, fontSize: 11, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: '#f0fdf4', padding: '6px 8px', borderRadius: 4, maxHeight: 200, overflowY: 'auto' }}>
                    {planLines.join('\n')}
                  </pre>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RawBucketView({ lines, label }: { lines: string[]; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, overflow: 'hidden', marginBottom: 8 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{ width: '100%', textAlign: 'left', background: '#f8fafc', padding: '8px 12px', border: 'none', cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'center', fontSize: 13, fontFamily: 'sans-serif', fontWeight: 700 }}
      >
        <span>{label}</span>
        <span style={{ color: '#64748b', fontWeight: 400 }}>{lines.length}줄</span>
        <span style={{ marginLeft: 'auto', color: '#94a3b8' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <pre style={{ margin: 0, padding: '8px 12px', fontSize: 11, lineHeight: 1.7, background: '#f8fafc', borderTop: '1px solid #e2e8f0', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 500, overflowY: 'auto' }}>
          {lines.map((line, i) => {
            const soap = soapHeaderType(line);
            if (soap) {
              const s = SOAP_COLORS[soap];
              return (
                <span key={i} style={{ display: 'block', background: s?.bg, color: s?.color, fontWeight: 700, padding: '2px 4px', borderRadius: 3, margin: '2px 0' }}>
                  [{s?.label}] {line}
                </span>
              );
            }
            return <span key={i} style={{ display: 'block' }}>{line}</span>;
          })}
        </pre>
      )}
    </div>
  );
}

export default function BucketDebugPage() {
  const [data, setData] = useState<BucketDebugResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [runIdInput, setRunIdInput] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('chartBody');

  const load = useCallback(async (runId?: string) => {
    setLoading(true);
    setData(null);
    try {
      const url = runId
        ? `/api/admin/debug/bucket-debug?runId=${encodeURIComponent(runId)}`
        : '/api/admin/debug/bucket-debug';
      const res = await fetch(url, { credentials: 'include' });
      setData(await res.json() as BucketDebugResult);
    } catch (e) {
      setData({ run: null, chartBodyByDate: [], bucketLines: { chartBody: [], lab: [], basicInfo: [], vitals: [] }, labItems: [], labItemsByDate: [], error: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const run = data?.run;
  const isPlusVet = run?.chartType === 'plusvet';

  const TABS: { key: Tab; label: string; count?: number }[] = [
    { key: 'chartBody', label: '차트 본문 (날짜별)', count: data?.chartBodyByDate.length },
    { key: 'lab', label: '검사 버킷 (raw)', count: data?.bucketLines.lab.length },
    { key: 'labItems', label: '추출된 검사항목', count: data?.labItems.length },
    { key: 'rawBuckets', label: '전체 버킷 raw' },
  ];

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1100, fontFamily: 'monospace' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 6 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0, fontFamily: 'sans-serif' }}>버킷 디버그</h1>
        <span style={{ fontSize: 13, color: '#64748b', fontFamily: 'sans-serif' }}>추출 과정 상세 보기</span>
      </div>

      {/* run 선택 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, alignItems: 'center' }}>
        <input
          value={runIdInput}
          onChange={(e) => setRunIdInput(e.target.value)}
          placeholder="runId (비워두면 최신 run)"
          style={{ flex: 1, maxWidth: 360, padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13, fontFamily: 'monospace' }}
        />
        <button
          onClick={() => void load(runIdInput.trim() || undefined)}
          disabled={loading}
          style={{ padding: '6px 16px', background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 6, cursor: loading ? 'not-allowed' : 'pointer', fontSize: 13, fontFamily: 'sans-serif' }}
        >
          {loading ? '로드 중…' : '불러오기'}
        </button>
      </div>

      {data?.error && (
        <p style={{ color: '#b91c1c', fontSize: 13, fontFamily: 'sans-serif' }}>오류: {data.error}</p>
      )}

      {!run && !loading && !data?.error && (
        <p style={{ color: '#94a3b8', fontSize: 13, fontFamily: 'sans-serif' }}>저장된 run이 없습니다.</p>
      )}

      {run && (
        <>
          {/* run 헤더 */}
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 14px', background: '#f8fafc', marginBottom: 16, fontSize: 13, fontFamily: 'sans-serif', display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center' }}>
            <span><strong>ID:</strong> {run.friendlyId ?? run.id}</span>
            <span><strong>시각:</strong> {new Date(run.createdAt).toLocaleString('ko-KR')}</span>
            <span><strong>파일:</strong> {run.fileName ?? '?'}</span>
            <span
              style={{ padding: '2px 10px', borderRadius: 12, fontWeight: 700, fontSize: 11,
                background: isPlusVet ? '#eff6ff' : '#f1f5f9',
                color: isPlusVet ? '#1d4ed8' : '#475569',
                border: `1px solid ${isPlusVet ? '#93c5fd' : '#e2e8f0'}` }}
            >
              {run.chartType ?? '차트종류 불명'}
            </span>
            {isPlusVet && (
              <span style={{ fontSize: 11, color: '#92400e', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 10, padding: '1px 8px' }}>
                SOAP 분리 활성
              </span>
            )}
          </div>

          {/* 탭 */}
          <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #e2e8f0', marginBottom: 16 }}>
            {TABS.map(({ key, label, count }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                style={{ padding: '8px 16px', border: 'none', borderBottom: activeTab === key ? '2px solid #1d4ed8' : '2px solid transparent', marginBottom: -2, background: 'none', cursor: 'pointer', fontSize: 13, fontFamily: 'sans-serif', fontWeight: activeTab === key ? 700 : 400, color: activeTab === key ? '#1d4ed8' : '#475569' }}
              >
                {label}
                {count !== undefined && (
                  <span style={{ marginLeft: 4, background: '#e2e8f0', borderRadius: 10, padding: '1px 6px', fontSize: 11 }}>{count}</span>
                )}
              </button>
            ))}
          </div>

          {/* 차트 본문 탭 */}
          {activeTab === 'chartBody' && (
            <div>
              {isPlusVet && (
                <div style={{ marginBottom: 10, padding: '6px 12px', background: '#eff6ff', borderRadius: 6, fontSize: 13, fontFamily: 'sans-serif', color: '#1d4ed8' }}>
                  PlusVet: Subjective → bodyText (파란색), Plan → planText (초록색), Objective는 버려짐
                </div>
              )}
              {data.chartBodyByDate.length === 0 ? (
                <p style={{ color: '#94a3b8', fontSize: 13, fontFamily: 'sans-serif' }}>날짜별 그룹이 없습니다.</p>
              ) : (
                data.chartBodyByDate.map((g) => (
                  <ChartBodyGroup key={g.dateTime} group={g} isPlusVet={isPlusVet} />
                ))
              )}
            </div>
          )}

          {/* 검사 버킷 탭 */}
          {activeTab === 'lab' && (
            <div>
              <div style={{ marginBottom: 10, fontSize: 13, color: '#64748b', fontFamily: 'sans-serif' }}>
                lab 버킷에 할당된 raw 줄 — 이 줄들로 검사항목을 파싱합니다.
                {isPlusVet && ' PlusVet은 "진단 검사 결과" 섹션 이후 + 검사기기 패널 헤더로 구분됩니다.'}
              </div>
              {data.bucketLines.lab.length === 0 ? (
                <p style={{ color: '#94a3b8', fontSize: 13, fontFamily: 'sans-serif' }}>lab 버킷이 비어 있습니다. 버케팅 규칙이 검사 섹션을 찾지 못했을 수 있습니다.</p>
              ) : (
                <pre style={{ margin: 0, padding: '10px 12px', fontSize: 11, lineHeight: 1.7, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 600, overflowY: 'auto' }}>
                  {data.bucketLines.lab.map((line, i) => (
                    <span key={i} style={{ display: 'block', borderBottom: '1px solid #f1f5f9', paddingBottom: 1 }}>{line}</span>
                  ))}
                </pre>
              )}
            </div>
          )}

          {/* 추출된 검사항목 탭 */}
          {activeTab === 'labItems' && (
            <div>
              {data.labItems.length === 0 ? (
                <p style={{ color: '#94a3b8', fontSize: 13, fontFamily: 'sans-serif' }}>추출된 검사항목이 없습니다.</p>
              ) : (
                <>
                  <div style={{ marginBottom: 8, fontSize: 13, color: '#64748b', fontFamily: 'sans-serif' }}>총 {data.labItems.length}개 항목</div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ background: '#f1f5f9' }}>
                          {['항목명', '결과값', '단위', '참고치', '플래그', '페이지'].map((h) => (
                            <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontFamily: 'sans-serif', fontWeight: 700, borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.labItems.map((item, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                            <td style={{ padding: '5px 10px', fontWeight: 600 }}>{item.itemName}</td>
                            <td style={{ padding: '5px 10px', color: FLAG_COLOR[item.flag] ?? '#0f172a', fontWeight: 600 }}>{item.valueText}</td>
                            <td style={{ padding: '5px 10px', color: '#64748b' }}>{item.unit ?? '-'}</td>
                            <td style={{ padding: '5px 10px', color: '#64748b' }}>{item.referenceRange ?? '-'}</td>
                            <td style={{ padding: '5px 10px' }}>
                              <span style={{ padding: '1px 7px', borderRadius: 10, fontSize: 11, fontWeight: 700, fontFamily: 'sans-serif', background: item.flag === 'high' ? '#fee2e2' : item.flag === 'low' ? '#dbeafe' : item.flag === 'normal' ? '#dcfce7' : '#f1f5f9', color: FLAG_COLOR[item.flag] ?? '#64748b' }}>
                                {item.flag}
                              </span>
                            </td>
                            <td style={{ padding: '5px 10px', color: '#94a3b8' }}>p{item.page}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {data.labItemsByDate.length > 1 && (
                    <div style={{ marginTop: 16 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, fontFamily: 'sans-serif', marginBottom: 8 }}>날짜별 그룹</div>
                      {data.labItemsByDate.map((g) => (
                        <div key={g.dateTime} style={{ marginBottom: 10, border: '1px solid #e2e8f0', borderRadius: 6, overflow: 'hidden' }}>
                          <div style={{ padding: '6px 12px', background: '#f8fafc', fontWeight: 700, fontSize: 13, borderBottom: '1px solid #e2e8f0' }}>{g.dateTime} ({g.items.length}건)</div>
                          <div style={{ padding: '6px 12px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {g.items.map((item, j) => (
                              <span key={j} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#f1f5f9', color: FLAG_COLOR[item.flag] ?? '#475569', border: '1px solid #e2e8f0' }}>
                                {item.itemName}: <strong>{item.valueText}</strong>{item.unit ? ` ${item.unit}` : ''}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* 전체 버킷 raw 탭 */}
          {activeTab === 'rawBuckets' && (
            <div>
              <RawBucketView lines={data.bucketLines.basicInfo} label="basicInfo (기본정보)" />
              <RawBucketView lines={data.bucketLines.chartBody} label="chartBody (차트본문)" />
              <RawBucketView lines={data.bucketLines.lab} label="lab (검사)" />
              <RawBucketView lines={data.bucketLines.vitals} label="vitals (바이탈)" />
            </div>
          )}
        </>
      )}
    </div>
  );
}
