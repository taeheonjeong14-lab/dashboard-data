'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { StatusBadge } from '@/components/status-badge';
import { WorkBoardQueue } from '@/components/work-board-queue';

type WorkItem = {
  runId: string;
  friendlyId: string | null;
  hospitalId: string | null;
  hospitalName: string | null;
  ownerName: string | null;
  patientName: string | null;
  type: 'health' | 'blog';
  stage: 'requested' | 'writing' | 'drafted' | 'saved' | 'done';
  requestedAt: string;
  completedAt: string | null;
  draftedAt: string | null;
};

function fmt(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d).replace(/\. /g, '.').replace(/\.$/, '');
}

// 작업 항목 한 줄 — pending: 요청 일시 + '열기' 버튼 / done: 완료 일시 / drafted: 작성완료 일시.
//  showBadge=false 면 좌측 상태 스티커를 숨긴다(섹션 제목에서 한 번만 표시하는 좁은 현황판용).
function ItemRow({ it, mode, compactLink, showBadge = true }: { it: WorkItem; mode: 'pending' | 'done' | 'drafted'; compactLink?: boolean; showBadge?: boolean }) {
  const timeLabel = mode === 'pending' ? '요청' : mode === 'drafted' ? '작성완료' : '완료';
  const timeValue = mode === 'pending' ? it.requestedAt : mode === 'drafted' ? it.draftedAt : it.completedAt;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-raised)' }}>
      {showBadge && <StatusBadge category={it.type} stage={it.stage} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {it.patientName || '—'}
          {it.ownerName ? <span style={{ fontWeight: 400, color: 'var(--text-secondary)' }}> · {it.ownerName}</span> : null}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {it.hospitalName || '병원 미상'}
          {it.friendlyId ? ` · #${it.friendlyId}` : ''}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{timeLabel}</div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
          {fmt(timeValue)}
        </div>
      </div>
      {mode === 'pending' && (
        <Link
          href={`/admin/chart-data?q=${encodeURIComponent(it.friendlyId || it.patientName || '')}&type=${it.type === 'health' ? '검진리포트' : '블로그'}`}
          style={{ flexShrink: 0, padding: '6px 10px', fontSize: 13, fontWeight: 600, color: 'var(--accent)', background: 'var(--accent-subtle)', border: '1px solid var(--accent)', borderRadius: 6, textDecoration: 'none', whiteSpace: 'nowrap' }}
        >
          {compactLink ? '열기 →' : '차트 목록에서 열기 →'}
        </Link>
      )}
    </div>
  );
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export default function WorkBoardPage() {
  const [pending, setPending] = useState<WorkItem[]>([]);
  const [done, setDone] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'board' | 'list' | 'queue'>('board');
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

  const hospitals = useMemo(
    () => [...new Set([...pending, ...done].map((i) => i.hospitalName?.trim() ?? '').filter(Boolean))].sort(),
    [pending, done],
  );

  // 병원별 잔여 수량 요약(검진 요청 / 블로그 요청 / 블로그 작성중 / 블로그 작성완료) — 합계 많은 순.
  const pendingSummary = useMemo(() => {
    const m = new Map<string, { health: number; blogReq: number; blogWriting: number; blogDrafted: number }>();
    for (const i of pending) {
      const h = i.hospitalName?.trim() || '병원 미상';
      let row = m.get(h);
      if (!row) { row = { health: 0, blogReq: 0, blogWriting: 0, blogDrafted: 0 }; m.set(h, row); }
      if (i.type === 'health') row.health += 1;
      else if (i.type === 'blog' && i.stage === 'requested') row.blogReq += 1;
      else if (i.type === 'blog' && i.stage === 'writing') row.blogWriting += 1;
      else if (i.type === 'blog' && i.stage === 'drafted') row.blogDrafted += 1;
    }
    return [...m.entries()]
      .map(([name, c]) => ({ name, ...c, total: c.health + c.blogReq + c.blogWriting + c.blogDrafted }))
      .sort((a, b) => b.total - a.total);
  }, [pending]);

  // 현황판 우측: 블로그 최근 1주일 저장완료 / 작성완료 — 각각 최신순.
  const withinWeek = (iso: string | null) => {
    const t = iso ? new Date(iso).getTime() : NaN;
    return !Number.isNaN(t) && t >= Date.now() - WEEK_MS;
  };
  const recentSaved = useMemo(
    () => done
      .filter((i) => i.type === 'blog' && i.stage === 'saved' && withinWeek(i.completedAt))
      .sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || '')),
    [done],
  );
  const recentHealthDone = useMemo(
    () => done
      .filter((i) => i.type === 'health' && i.stage === 'done' && withinWeek(i.completedAt))
      .sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || '')),
    [done],
  );
  const recentDrafted = useMemo(
    () => pending
      .filter((i) => i.type === 'blog' && i.stage === 'drafted' && withinWeek(i.draftedAt))
      .sort((a, b) => (b.draftedAt || '').localeCompare(a.draftedAt || '')),
    [pending],
  );

  // 작업 목록: 잔여를 종류별로 분리(+병원 필터).
  const listFiltered = useMemo(
    () => (hospital ? pending.filter((i) => (i.hospitalName?.trim() ?? '') === hospital) : pending),
    [pending, hospital],
  );
  const pendingHealth = useMemo(() => listFiltered.filter((i) => i.type === 'health'), [listFiltered]);
  const pendingBlog = useMemo(() => listFiltered.filter((i) => i.type === 'blog'), [listFiltered]);

  const tabBtn = (key: 'board' | 'list' | 'queue'): React.CSSProperties => ({
    padding: '9px 14px', fontSize: 13, fontWeight: tab === key ? 700 : 500,
    color: tab === key ? 'var(--accent)' : 'var(--text-muted)', background: 'none', border: 'none',
    borderBottom: `2px solid ${tab === key ? 'var(--accent)' : 'transparent'}`, marginBottom: -1, cursor: 'pointer', whiteSpace: 'nowrap',
  });

  const colHeader: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10, fontSize: 13, fontWeight: 700, color: 'var(--text)',
  };

  return (
    <div style={{ paddingBottom: 40 }}>
      <h1 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', margin: '0 0 4px' }}>작업 현황</h1>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 18px' }}>병원이 요청한 검진리포트·진료케이스(블로그) 작업의 현황과 잔여 목록입니다.</p>

      {/* 탭 */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 16 }}>
        <button type="button" onClick={() => setTab('board')} style={tabBtn('board')}>현황판</button>
        <button type="button" onClick={() => setTab('list')} style={tabBtn('list')}>
          잔여 작업 {pending.length > 0 ? `(${pending.length})` : ''}
        </button>
        <button type="button" onClick={() => setTab('queue')} style={tabBtn('queue')}>작업 목록</button>
      </div>

      {loading ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>불러오는 중…</p>
      ) : error ? (
        <p style={{ fontSize: 13, color: 'var(--danger)' }}>{error}</p>
      ) : tab === 'board' ? (
        /* ── 현황판: 좌 병원별 잔여 수량 표 / 우 최근 1주일 완료 ── */
        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* 1: 병원별 잔여 수량 */}
          <div style={{ flex: '1 1 300px', minWidth: 290, maxWidth: '100%' }}>
            <div style={colHeader}>
              <span style={{ display: 'inline-flex', width: 4, height: 14, borderRadius: 2, background: '#dc2626' }} />
              <span>병원별 잔여 수량</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>{pending.length}건</span>
            </div>
            {pendingSummary.length > 0 ? (
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                      <th style={{ textAlign: 'left', padding: '6px 12px', fontWeight: 600 }}>병원</th>
                      <th style={{ textAlign: 'center', padding: '6px 6px', fontWeight: 600, width: 76 }}>검진리포트<br />요청</th>
                      <th style={{ textAlign: 'center', padding: '6px 6px', fontWeight: 600, width: 70 }}>블로그<br />요청</th>
                      <th style={{ textAlign: 'center', padding: '6px 12px', fontWeight: 600, width: 76 }}>블로그<br />작성완료</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingSummary.map((r) => {
                      const cell = (n: number, c: string) => <span style={{ fontWeight: n > 0 ? 700 : 400, color: n > 0 ? c : 'var(--text-muted)' }}>{n}</span>;
                      return (
                        <tr key={r.name} title="잔여 작업에서 이 병원만 보기"
                          style={{ borderTop: '1px solid var(--border)', cursor: 'pointer' }}
                          onClick={() => { setHospital(r.name === '병원 미상' ? '' : r.name); setTab('list'); }}>
                          <td style={{ padding: '7px 12px', color: 'var(--text)' }}>{r.name}</td>
                          <td style={{ textAlign: 'center', padding: '7px 6px' }}>{cell(r.health, '#2563eb')}</td>
                          <td style={{ textAlign: 'center', padding: '7px 6px' }}>{cell(r.blogReq, '#dc2626')}</td>
                          <td style={{ textAlign: 'center', padding: '7px 12px' }}>{cell(r.blogDrafted, '#16a34a')}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--text-muted)', padding: '40px 0', textAlign: 'center' }}>잔여 작업이 없습니다. 👍</p>
            )}
          </div>

          {/* 2: 검진 리포트 최근 1주일 완료 */}
          <div style={{ flex: '1 1 260px', minWidth: 250, maxWidth: '100%' }}>
            <div style={colHeader}>
              <StatusBadge category="health" stage="done" />
              <span>최근 1주일 검진 리포트 완료</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>{recentHealthDone.length}건</span>
            </div>
            {recentHealthDone.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text-muted)', padding: '24px 0', textAlign: 'center' }}>최근 1주일간 완료된 검진 리포트가 없습니다.</p>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {recentHealthDone.map((it) => <ItemRow key={`${it.runId}-health`} it={it} mode="done" showBadge={false} />)}
              </div>
            )}
          </div>

          {/* 3: 블로그 최근 1주일 작성완료 */}
          <div style={{ flex: '1 1 260px', minWidth: 250, maxWidth: '100%' }}>
            <div style={colHeader}>
              <StatusBadge category="blog" stage="drafted" />
              <span>최근 1주일 블로그 작성완료</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>{recentDrafted.length}건</span>
            </div>
            {recentDrafted.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text-muted)', padding: '24px 0', textAlign: 'center' }}>최근 1주일간 작성완료된 블로그가 없습니다.</p>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {recentDrafted.map((it) => <ItemRow key={`${it.runId}-drafted`} it={it} mode="drafted" showBadge={false} />)}
              </div>
            )}
          </div>

          {/* 4: 블로그 최근 1주일 저장완료 */}
          <div style={{ flex: '1 1 260px', minWidth: 250, maxWidth: '100%' }}>
            <div style={colHeader}>
              <StatusBadge category="blog" stage="saved" />
              <span>최근 1주일 블로그 저장완료</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>{recentSaved.length}건</span>
            </div>
            {recentSaved.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text-muted)', padding: '24px 0', textAlign: 'center' }}>최근 1주일간 저장완료된 블로그가 없습니다.</p>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {recentSaved.map((it) => <ItemRow key={`${it.runId}-saved`} it={it} mode="done" showBadge={false} />)}
              </div>
            )}
          </div>
        </div>
      ) : tab === 'list' ? (
        /* ── 잔여 작업: 좌 건강검진 리포트 / 우 블로그 ── */
        <div>
          {/* 병원 필터 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            <select value={hospital} onChange={(e) => setHospital(e.target.value)}
              style={{ padding: '6px 10px', fontSize: 13, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}>
              <option value="">전체 병원</option>
              {hospitals.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
            {hospital && (
              <button type="button" onClick={() => setHospital('')}
                style={{ padding: '6px 10px', fontSize: 13, fontWeight: 500, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                필터 해제 ✕
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            {/* 좌: 건강검진 리포트 */}
            <div style={{ flex: 1, minWidth: 320 }}>
              <div style={colHeader}>
                <span style={{ display: 'inline-flex', width: 4, height: 14, borderRadius: 2, background: '#2563eb' }} />
                <span>건강검진 리포트</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>{pendingHealth.length}건</span>
              </div>
              {pendingHealth.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--text-muted)', padding: '30px 0', textAlign: 'center' }}>잔여 검진 리포트가 없습니다.</p>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {pendingHealth.map((it) => <ItemRow key={`${it.runId}-${it.type}`} it={it} mode="pending" compactLink />)}
                </div>
              )}
            </div>

            {/* 우: 블로그 */}
            <div style={{ flex: 1, minWidth: 320 }}>
              <div style={colHeader}>
                <span style={{ display: 'inline-flex', width: 4, height: 14, borderRadius: 2, background: '#dc2626' }} />
                <span>블로그</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>{pendingBlog.length}건</span>
              </div>
              {pendingBlog.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--text-muted)', padding: '30px 0', textAlign: 'center' }}>잔여 블로그가 없습니다.</p>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {pendingBlog.map((it) => <ItemRow key={`${it.runId}-${it.type}`} it={it} mode="pending" compactLink />)}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* ── 작업 목록: 블로그 작업 배정(팀장→팀원) + 날짜별 히스토리 ── */
        <WorkBoardQueue blogItems={[...pending, ...done].filter((i) => i.type === 'blog')} />
      )}
    </div>
  );
}
