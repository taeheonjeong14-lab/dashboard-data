'use client';

import { useCallback, useEffect, useState } from 'react';
import { explainError } from '@/lib/error-log-explain';

type ErrorLog = {
  id: string;
  occurred_at: string;
  app: string;
  source: 'server' | 'client';
  route: string | null;
  method: string | null;
  status_code: number | null;
  feature: string | null;
  message: string;
  stack: string | null;
  hospital_id: string | null;
  hospital_name: string | null;
  user_id: string | null;
  request_body: unknown;
  context: Record<string, unknown>;
  fingerprint: string;
};

type Response = { logs: ErrorLog[]; total: number; pageSize: number; page: number; error?: string };

const DAY_OPTIONS = [1, 7, 30];
const SOURCE_OPTIONS = [
  { value: '', label: '전체' },
  { value: 'server', label: '서버' },
  { value: 'client', label: '브라우저' },
];

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', { hour12: false });
}

const codeBoxStyle: React.CSSProperties = {
  background: '#0f172a',
  color: '#e2e8f0',
  padding: 12,
  borderRadius: 6,
  fontSize: 12,
  fontFamily: 'ui-monospace, monospace',
  overflowX: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  margin: '6px 0 14px',
};

export default function AdminErrorLogs() {
  const [logs, setLogs] = useState<ErrorLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [days, setDays] = useState(7);
  const [source, setSource] = useState('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState(''); // 실제 요청에 쓰이는 확정 검색어
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ days: String(days), page: String(page) });
      if (source) params.set('source', source);
      if (query) params.set('q', query);
      const res = await fetch(`/api/admin/error-logs?${params}`);
      const json = (await res.json()) as Response;
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setLogs(json.logs);
      setTotal(json.total);
      setPageSize(json.pageSize);
    } catch (e) {
      setError(e instanceof Error ? e.message : '불러오지 못했습니다.');
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [days, page, source, query]);

  useEffect(() => {
    void load();
  }, [load]);

  const lastPage = Math.max(Math.ceil(total / pageSize) - 1, 0);

  return (
    <div style={{ padding: 24, maxWidth: 1200 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>에러 로그</h1>
      <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 20 }}>
        hospital-web 에서 발생한 서버·브라우저 오류. 요청 본문은 민감정보 마스킹 후 저장됩니다.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        {DAY_OPTIONS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => {
              setDays(d);
              setPage(0);
            }}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              fontSize: 13,
              cursor: 'pointer',
              border: '1px solid #d4d4d8',
              background: days === d ? '#111827' : '#fff',
              color: days === d ? '#fff' : '#111827',
            }}
          >
            최근 {d}일
          </button>
        ))}

        <select
          value={source}
          onChange={(e) => {
            setSource(e.target.value);
            setPage(0);
          }}
          style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #d4d4d8', fontSize: 13 }}
        >
          {SOURCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setPage(0);
            setQuery(q);
          }}
          style={{ display: 'flex', gap: 6 }}
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="메시지 · 경로 검색"
            style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #d4d4d8', fontSize: 13, width: 220 }}
          />
          <button
            type="submit"
            style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #d4d4d8', background: '#fff', cursor: 'pointer', fontSize: 13 }}
          >
            검색
          </button>
        </form>

        <span style={{ marginLeft: 'auto', color: '#6b7280', fontSize: 13 }}>총 {total.toLocaleString()}건</span>
      </div>

      {error ? <p style={{ color: '#b91c1c', fontSize: 13 }}>{error}</p> : null}
      {loading ? <p style={{ color: '#6b7280', fontSize: 13 }}>불러오는 중…</p> : null}
      {!loading && !error && logs.length === 0 ? (
        <p style={{ color: '#6b7280', fontSize: 13 }}>해당 기간에 기록된 오류가 없습니다.</p>
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {logs.map((log) => {
          const open = expanded === log.id;
          return (
            <div key={log.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
              <button
                type="button"
                onClick={() => setExpanded(open ? null : log.id)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 14px',
                  background: open ? '#f9fafb' : '#fff',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  gap: 10,
                  alignItems: 'baseline',
                  flexWrap: 'wrap',
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '2px 6px',
                    borderRadius: 4,
                    background: log.source === 'client' ? '#eff6ff' : '#fef2f2',
                    color: log.source === 'client' ? '#1d4ed8' : '#b91c1c',
                  }}
                >
                  {log.source === 'client' ? '브라우저' : '서버'}
                </span>
                {log.status_code ? (
                  <span style={{ fontSize: 12, color: '#6b7280', fontFamily: 'ui-monospace, monospace' }}>
                    {log.method} {log.status_code}
                  </span>
                ) : null}
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: '1 1 320px', minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{log.message}</span>
                  <span style={{ fontSize: 12, color: '#4b5563', fontWeight: 400 }}>{explainError(log)}</span>
                </span>
                <span style={{ fontSize: 12, color: '#6b7280' }}>{log.feature ?? log.route ?? '-'}</span>
                <span style={{ fontSize: 12, color: '#9ca3af' }}>{log.hospital_name ?? '병원 미상'}</span>
                <span style={{ fontSize: 12, color: '#9ca3af' }}>{formatTime(log.occurred_at)}</span>
              </button>

              {open ? (
                <div style={{ padding: '0 14px 14px', borderTop: '1px solid #f3f4f6' }}>
                  <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 16px', fontSize: 12, margin: '12px 0' }}>
                    <dt style={{ color: '#6b7280' }}>경로</dt>
                    <dd style={{ fontFamily: 'ui-monospace, monospace', margin: 0 }}>{log.route ?? '-'}</dd>
                    <dt style={{ color: '#6b7280' }}>지문</dt>
                    <dd style={{ fontFamily: 'ui-monospace, monospace', margin: 0 }}>{log.fingerprint}</dd>
                    <dt style={{ color: '#6b7280' }}>병원</dt>
                    <dd style={{ margin: 0 }}>{log.hospital_name ?? log.hospital_id ?? '-'}</dd>
                    <dt style={{ color: '#6b7280' }}>사용자</dt>
                    <dd style={{ fontFamily: 'ui-monospace, monospace', margin: 0 }}>{log.user_id ?? '-'}</dd>
                  </dl>

                  {log.stack ? (
                    <>
                      <strong style={{ fontSize: 12 }}>스택</strong>
                      <pre style={codeBoxStyle}>{log.stack}</pre>
                    </>
                  ) : null}

                  {log.request_body ? (
                    <>
                      <strong style={{ fontSize: 12 }}>요청 본문 (마스킹됨)</strong>
                      <pre style={codeBoxStyle}>{JSON.stringify(log.request_body, null, 2)}</pre>
                    </>
                  ) : null}

                  {log.context && Object.keys(log.context).length > 0 ? (
                    <>
                      <strong style={{ fontSize: 12 }}>컨텍스트</strong>
                      <pre style={codeBoxStyle}>{JSON.stringify(log.context, null, 2)}</pre>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {total > pageSize ? (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 20, alignItems: 'center' }}>
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(p - 1, 0))}
            style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #d4d4d8', background: '#fff', cursor: page === 0 ? 'default' : 'pointer', fontSize: 13, opacity: page === 0 ? 0.5 : 1 }}
          >
            이전
          </button>
          <span style={{ fontSize: 13, color: '#6b7280' }}>
            {page + 1} / {lastPage + 1}
          </span>
          <button
            type="button"
            disabled={page >= lastPage}
            onClick={() => setPage((p) => Math.min(p + 1, lastPage))}
            style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #d4d4d8', background: '#fff', cursor: page >= lastPage ? 'default' : 'pointer', fontSize: 13, opacity: page >= lastPage ? 0.5 : 1 }}
          >
            다음
          </button>
        </div>
      ) : null}
    </div>
  );
}
