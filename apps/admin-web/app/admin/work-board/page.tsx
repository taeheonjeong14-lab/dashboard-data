'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { StatusBadge } from '@/components/status-badge';

type WorkItem = {
  runId: string;
  friendlyId: string | null;
  hospitalId: string | null;
  hospitalName: string | null;
  ownerName: string | null;
  patientName: string | null;
  type: 'health' | 'blog';
  stage: 'requested' | 'writing' | 'done';
  requestedAt: string;
  completedAt: string | null;
};

function fmt(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d).replace(/\. /g, '.').replace(/\.$/, '');
}

export default function WorkBoardPage() {
  const [pending, setPending] = useState<WorkItem[]>([]);
  const [done, setDone] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'pending' | 'done'>('pending');
  const [hospital, setHospital] = useState('');
  const [typeFilter, setTypeFilter] = useState<'' | 'health' | 'blog'>('');

  useEffect(() => {
    (async () => {
      setLoading(true); setError(null);
      try {
        const res = await fetch('/api/admin/work-board', { credentials: 'include' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '불러오기 실패');
        setPending(data.pending ?? []);
        setDone(data.done ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : '불러오기 실패');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const list = tab === 'pending' ? pending : done;
  const hospitals = useMemo(
    () => [...new Set([...pending, ...done].map((i) => i.hospitalName?.trim() ?? '').filter(Boolean))].sort(),
    [pending, done],
  );
  const filtered = useMemo(() => {
    let l = list;
    if (hospital) l = l.filter((i) => (i.hospitalName?.trim() ?? '') === hospital);
    if (typeFilter) l = l.filter((i) => i.type === typeFilter);
    return l;
  }, [list, hospital, typeFilter]);

  // 병원별 잔여 수량 요약(검진 요청 / 블로그 요청 / 블로그 작성중) — 합계 많은 순.
  const pendingSummary = useMemo(() => {
    const m = new Map<string, { health: number; blogReq: number; blogWriting: number }>();
    for (const i of pending) {
      const h = i.hospitalName?.trim() || '병원 미상';
      let row = m.get(h);
      if (!row) { row = { health: 0, blogReq: 0, blogWriting: 0 }; m.set(h, row); }
      if (i.type === 'health') row.health += 1;
      else if (i.type === 'blog' && i.stage === 'requested') row.blogReq += 1;
      else if (i.type === 'blog' && i.stage === 'writing') row.blogWriting += 1;
    }
    return [...m.entries()]
      .map(([name, c]) => ({ name, ...c, total: c.health + c.blogReq + c.blogWriting }))
      .sort((a, b) => b.total - a.total);
  }, [pending]);
  const summaryTotals = pendingSummary.reduce(
    (s, r) => ({ health: s.health + r.health, blogReq: s.blogReq + r.blogReq, blogWriting: s.blogWriting + r.blogWriting }),
    { health: 0, blogReq: 0, blogWriting: 0 },
  );

  const tabBtn = (key: 'pending' | 'done', label: string, n: number): React.CSSProperties => ({
    padding: '9px 14px', fontSize: 14, fontWeight: tab === key ? 700 : 500,
    color: tab === key ? 'var(--accent)' : 'var(--text-muted)', background: 'none', border: 'none',
    borderBottom: `2px solid ${tab === key ? 'var(--accent)' : 'transparent'}`, marginBottom: -1, cursor: 'pointer', whiteSpace: 'nowrap',
  });
  void tabBtn;

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 20px 60px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', margin: '0 0 4px' }}>작업 현황</h1>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 18px' }}>병원이 요청한 검진리포트·진료케이스(블로그) 작업의 잔여·완료 현황입니다.</p>

      {/* 탭 */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 14 }}>
        <button type="button" onClick={() => setTab('pending')} style={tabBtn('pending', '', 0)}>잔여 작업 {pending.length > 0 ? `(${pending.length})` : ''}</button>
        <button type="button" onClick={() => setTab('done')} style={tabBtn('done', '', 0)}>완료 작업 {done.length > 0 ? `(${done.length})` : ''}</button>
      </div>

      {/* 병원별 잔여 수량 요약 (잔여 탭에서만) */}
      {tab === 'pending' && !loading && !error && pendingSummary.length > 0 && (
        <div style={{ marginBottom: 16, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '8px 12px', fontSize: 12.5, fontWeight: 700, color: 'var(--text-secondary)', background: 'var(--bg-subtle)' }}>병원별 잔여 수량</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>
                <th style={{ textAlign: 'left', padding: '6px 12px', fontWeight: 600 }}>병원</th>
                <th style={{ textAlign: 'center', padding: '6px 8px', fontWeight: 600, width: 84 }}>검진 요청</th>
                <th style={{ textAlign: 'center', padding: '6px 8px', fontWeight: 600, width: 84 }}>블로그 요청</th>
                <th style={{ textAlign: 'center', padding: '6px 8px', fontWeight: 600, width: 84 }}>블로그 작성중</th>
                <th style={{ textAlign: 'center', padding: '6px 12px', fontWeight: 700, width: 64 }}>합계</th>
              </tr>
            </thead>
            <tbody>
              {pendingSummary.map((r) => {
                const cell = (n: number, color: string) => <span style={{ fontWeight: n > 0 ? 700 : 400, color: n > 0 ? color : 'var(--text-muted)' }}>{n}</span>;
                return (
                  <tr key={r.name} style={{ borderTop: '1px solid var(--border)', cursor: 'pointer' }} onClick={() => setHospital(r.name === '병원 미상' ? '' : r.name)}>
                    <td style={{ padding: '7px 12px', color: 'var(--text)' }}>{r.name}</td>
                    <td style={{ textAlign: 'center', padding: '7px 8px' }}>{cell(r.health, '#2563eb')}</td>
                    <td style={{ textAlign: 'center', padding: '7px 8px' }}>{cell(r.blogReq, '#dc2626')}</td>
                    <td style={{ textAlign: 'center', padding: '7px 8px' }}>{cell(r.blogWriting, '#ea580c')}</td>
                    <td style={{ textAlign: 'center', padding: '7px 12px', fontWeight: 700, color: 'var(--text)' }}>{r.total}</td>
                  </tr>
                );
              })}
              <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--bg-subtle)' }}>
                <td style={{ padding: '7px 12px', fontWeight: 700, color: 'var(--text)' }}>합계</td>
                <td style={{ textAlign: 'center', padding: '7px 8px', fontWeight: 700 }}>{summaryTotals.health}</td>
                <td style={{ textAlign: 'center', padding: '7px 8px', fontWeight: 700 }}>{summaryTotals.blogReq}</td>
                <td style={{ textAlign: 'center', padding: '7px 8px', fontWeight: 700 }}>{summaryTotals.blogWriting}</td>
                <td style={{ textAlign: 'center', padding: '7px 12px', fontWeight: 800, color: 'var(--text)' }}>{summaryTotals.health + summaryTotals.blogReq + summaryTotals.blogWriting}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* 필터: 병원 + 종류 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <select value={hospital} onChange={(e) => setHospital(e.target.value)}
          style={{ padding: '6px 10px', fontSize: 13, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}>
          <option value="">전체 병원</option>
          {hospitals.map((h) => <option key={h} value={h}>{h}</option>)}
        </select>
        {([['', '전체'], ['health', '검진리포트'], ['blog', '블로그']] as const).map(([val, label]) => (
          <button key={val} type="button" onClick={() => setTypeFilter(val)}
            style={{ padding: '6px 12px', fontSize: 12.5, fontWeight: typeFilter === val ? 700 : 500, borderRadius: 999, cursor: 'pointer',
              border: `1px solid ${typeFilter === val ? 'var(--accent)' : 'var(--border)'}`,
              background: typeFilter === val ? 'var(--accent-subtle)' : 'var(--bg)', color: typeFilter === val ? 'var(--accent)' : 'var(--text-secondary)' }}>
            {label}
          </button>
        ))}
        <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{filtered.length}건</span>
      </div>

      {loading ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>불러오는 중…</p>
      ) : error ? (
        <p style={{ fontSize: 13, color: 'var(--danger)' }}>{error}</p>
      ) : filtered.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', padding: '40px 0', textAlign: 'center' }}>
          {tab === 'pending' ? '잔여 작업이 없습니다. 👍' : '완료된 작업이 없습니다.'}
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {filtered.map((it) => (
            <div key={`${it.runId}-${it.type}`} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-raised)' }}>
              <StatusBadge category={it.type} stage={it.stage} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {it.patientName || '—'}
                  {it.ownerName ? <span style={{ fontWeight: 400, color: 'var(--text-secondary)' }}> · {it.ownerName}</span> : null}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  {it.hospitalName || '병원 미상'}
                  {it.friendlyId ? ` · #${it.friendlyId}` : ''}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{tab === 'pending' ? '요청' : '완료'}</div>
                <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                  {fmt(tab === 'pending' ? it.requestedAt : it.completedAt)}
                </div>
              </div>
              {tab === 'pending' && (
                <Link
                  href={`/admin/chart-data?q=${encodeURIComponent(it.friendlyId || it.patientName || '')}&type=${it.type === 'health' ? '검진리포트' : '블로그'}`}
                  style={{ flexShrink: 0, padding: '6px 12px', fontSize: 12.5, fontWeight: 600, color: 'var(--accent)', background: 'var(--accent-subtle)', border: '1px solid var(--accent)', borderRadius: 6, textDecoration: 'none', whiteSpace: 'nowrap' }}
                >
                  차트 목록에서 열기 →
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
