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
  const filtered = useMemo(
    () => (hospital ? list.filter((i) => (i.hospitalName?.trim() ?? '') === hospital) : list),
    [list, hospital],
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

      {/* 병원 필터 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <select value={hospital} onChange={(e) => setHospital(e.target.value)}
          style={{ padding: '6px 10px', fontSize: 13, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}>
          <option value="">전체 병원</option>
          {hospitals.map((h) => <option key={h} value={h}>{h}</option>)}
        </select>
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
