'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { StatusBadge } from '@/components/status-badge';

// 작업 현황판 '작업 목록' 탭 — 팀장이 주 1회 블로그 작업을 배정하면 팀원이 보고 처리.
//  board 'blog_write': 요청·작성중 → 작성완료 / board 'blog_save': 작성완료 → 저장완료
//  배정은 '작업 배정' 모달에서 현재 풀 항목을 골라(요청자·마감일) 추가한다.
//  배정된 목록은 요청 날짜별로 묶여 히스토리로 남고, 작업이 진행돼 다음 단계로 가면 '완료'로 표시된다.

export type QueueItem = {
  runId: string;
  friendlyId: string | null;
  hospitalName: string | null;
  ownerName: string | null;
  patientName: string | null;
  stage: 'requested' | 'writing' | 'drafted' | 'saved' | 'done';
};

type ReqDto = {
  id: string; runId: string; board: 'blog_write' | 'blog_save';
  requester: string; dueDate: string | null; sortOrder: number; createdAt: string;
};

type Board = 'blog_write' | 'blog_save';
const BOARDS: {
  key: Board; title: string; flow: string;
  poolStages: QueueItem['stage'][];   // 배정 가능한(아직 목표 미달) 단계
  doneStages: QueueItem['stage'][];   // 이 보드 목표를 달성(완료)한 단계
}[] = [
  { key: 'blog_write', title: '블로그 작성', flow: '요청 → 작성완료', poolStages: ['requested', 'writing'], doneStages: ['drafted', 'saved'] },
  { key: 'blog_save', title: '블로그 저장', flow: '작성완료 → 저장완료', poolStages: ['drafted'], doneStages: ['saved'] },
];

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: '2-digit', month: '2-digit', day: '2-digit' }).format(d).replace(/\. /g, '.').replace(/\.$/, '');
}
// 마감일 그룹 헤더(D-day 상대 표기 + 색). dueKey='' 면 마감일 없음.
function dueHeader(dueKey: string): { text: string; color: string } {
  if (!dueKey) return { text: '마감일 없음', color: 'var(--text-muted)' };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(dueKey + 'T00:00:00');
  const wd = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', weekday: 'short' }).format(d);
  const days = Math.round((d.getTime() - today.getTime()) / 86400000);
  const rel = days < 0 ? `${-days}일 지남` : days === 0 ? '오늘' : days === 1 ? '내일' : `${days}일 남음`;
  const color = days < 0 ? '#dc2626' : days <= 1 ? '#ea580c' : 'var(--accent)';
  return { text: `마감 ${fmtDate(dueKey)} (${wd}) · ${rel}`, color };
}

export function WorkBoardQueue({ blogItems }: { blogItems: QueueItem[] }) {
  const [requests, setRequests] = useState<ReqDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const itemByRun = useMemo(() => new Map(blogItems.map((i) => [i.runId, i])), [blogItems]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/admin/work-board/requests', { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '불러오기 실패');
      setRequests(data.requests ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '불러오기 실패');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const assignedByBoard = useMemo(() => {
    const m: Record<Board, Set<string>> = { blog_write: new Set(), blog_save: new Set() };
    for (const r of requests) m[r.board].add(r.runId);
    return m;
  }, [requests]);

  // 날짜 그룹 펼침 — 기본은 각 보드의 가장 최근 그룹만 펼침. 헤더 클릭으로 토글(override).
  const [openOverride, setOpenOverride] = useState<Map<string, boolean>>(new Map());
  const toggleGroup = (key: string, cur: boolean) => setOpenOverride((prev) => { const n = new Map(prev); n.set(key, !cur); return n; });

  // 배정 모달
  const [assignBoard, setAssignBoard] = useState<Board | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [requester, setRequester] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [saving, setSaving] = useState(false);

  const openAssign = (board: Board) => { setAssignBoard(board); setSelected(new Set()); setRequester(''); setDueDate(''); };

  const assignPool = useMemo(() => {
    if (!assignBoard) return [] as QueueItem[];
    const b = BOARDS.find((x) => x.key === assignBoard)!;
    return blogItems.filter((i) => b.poolStages.includes(i.stage) && !assignedByBoard[assignBoard].has(i.runId));
  }, [assignBoard, blogItems, assignedByBoard]);

  // 병원별 (선택수 / 가능수) — 팀장이 고르게 배정하도록 실시간 카운트.
  const hospitalCounts = useMemo(() => {
    const avail = new Map<string, number>();
    for (const it of assignPool) { const h = it.hospitalName?.trim() || '병원 미상'; avail.set(h, (avail.get(h) ?? 0) + 1); }
    const sel = new Map<string, number>();
    for (const id of selected) { const h = itemByRun.get(id)?.hospitalName?.trim() || '병원 미상'; sel.set(h, (sel.get(h) ?? 0) + 1); }
    return [...avail.entries()].map(([h, a]) => ({ h, avail: a, sel: sel.get(h) ?? 0 })).sort((x, y) => y.avail - x.avail || x.h.localeCompare(y.h));
  }, [assignPool, selected, itemByRun]);

  async function submitAssign() {
    if (!assignBoard || selected.size === 0) return;
    setSaving(true);
    try {
      const res = await fetch('/api/admin/work-board/requests', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board: assignBoard, runIds: [...selected], requester, dueDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '배정 실패');
      setAssignBoard(null);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : '배정 실패');
    } finally { setSaving(false); }
  }

  async function removeReq(id: string) {
    if (!window.confirm('이 항목을 작업 목록에서 제거할까요?')) return;
    setRequests((prev) => prev.filter((r) => r.id !== id));
    try {
      const res = await fetch(`/api/admin/work-board/requests/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error('삭제 실패');
    } catch { await load(); }
  }

  if (loading) return <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>불러오는 중…</p>;
  if (error) return <p style={{ fontSize: 13, color: 'var(--danger)' }}>{error}</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      {BOARDS.map((b) => {
        const reqs = requests.filter((r) => r.board === b.key);
        // 마감일별 그룹 — 같은 마감일이면 언제 추가했든 한 그룹. 최신 마감 먼저, '마감일 없음'은 맨 아래.
        const byDate = new Map<string, ReqDto[]>();
        for (const r of reqs) {
          const k = r.dueDate ?? '';
          (byDate.get(k) ?? byDate.set(k, []).get(k)!).push(r);
        }
        for (const arr of byDate.values()) arr.sort((a, c) => (a.createdAt < c.createdAt ? 1 : -1)); // 그룹 내 요청 최신 먼저
        const dateKeys = [...byDate.keys()].sort((a, c) => (a === '' ? 1 : c === '' ? -1 : a < c ? 1 : -1));
        const badgeStage = b.key === 'blog_write' ? 'requested' : 'drafted';
        const activeCount = reqs.filter((r) => { const it = itemByRun.get(r.runId); return it && b.poolStages.includes(it.stage); }).length;

        return (
          <section key={b.key} style={{ flex: '1 1 360px', minWidth: 320, maxWidth: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              <StatusBadge category="blog" stage={badgeStage} />
              <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>{b.title}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>{b.flow}</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>· 진행 중 {activeCount}건</span>
              <button type="button" onClick={() => openAssign(b.key)}
                style={{ marginLeft: 'auto', padding: '7px 14px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: '1px solid var(--accent)', background: 'var(--accent)', color: '#fff', cursor: 'pointer' }}>
                + 작업 배정
              </button>
            </div>

            {dateKeys.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text-muted)', padding: '20px 0', textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 10 }}>
                아직 배정된 작업이 없습니다. ‘작업 배정’으로 추가하세요.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {dateKeys.map((dk, gi) => {
                  const gkey = `${b.key}:${dk}`;
                  const open = openOverride.has(gkey) ? openOverride.get(gkey)! : gi === 0;
                  const hdr = dueHeader(dk);
                  return (
                  <div key={dk || 'none'}>
                    <button type="button" onClick={() => toggleGroup(gkey, open)}
                      style={{ display: 'flex', alignItems: 'center', gap: 5, width: '100%', textAlign: 'left', border: 0, background: 'transparent', cursor: 'pointer', padding: 0, marginBottom: 8, fontSize: 12.5, fontWeight: 700, color: hdr.color, letterSpacing: '0.02em' }}>
                      <span style={{ display: 'inline-block', transition: 'transform .12s', transform: open ? 'rotate(90deg)' : 'none', fontSize: 10 }}>▶</span>
                      {hdr.text}
                      <span style={{ fontWeight: 500, color: 'var(--text-muted)' }}>{byDate.get(dk)!.length}건</span>
                    </button>
                    {open && (
                    <div style={{ display: 'grid', gap: 8 }}>
                      {byDate.get(dk)!.map((r) => {
                        const it = itemByRun.get(r.runId);
                        const stage = it?.stage ?? 'requested';
                        const isDone = it ? b.doneStages.includes(stage) : false;
                        return (
                          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 12px', borderRadius: 8, border: '1px solid var(--border)', background: isDone ? 'var(--bg-subtle)' : 'var(--bg-raised)', opacity: isDone ? 0.72 : 1 }}>
                            {it ? <StatusBadge category="blog" stage={stage} /> : null}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {it?.patientName || '—'}{it?.ownerName ? <span style={{ fontWeight: 400, color: 'var(--text-secondary)' }}> · {it.ownerName}</span> : null}
                                {isDone ? <span style={{ marginLeft: 6, fontSize: 11.5, fontWeight: 700, color: '#16a34a' }}>✓ 완료</span> : null}
                              </div>
                              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {it?.hospitalName || '병원 미상'}{it?.friendlyId ? ` · #${it.friendlyId}` : ''}
                              </div>
                              <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 11.5 }}>
                                {r.requester ? <span style={{ color: 'var(--text-secondary)' }}>요청자 <b style={{ color: 'var(--text)' }}>{r.requester}</b></span> : null}
                                <span style={{ color: 'var(--text-muted)' }}>요청 {fmtDate(r.createdAt)}</span>
                              </div>
                            </div>
                            <button type="button" onClick={() => void removeReq(r.id)} title="목록에서 제거"
                              style={{ flexShrink: 0, border: 0, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 2 }}>×</button>
                          </div>
                        );
                      })}
                    </div>
                    )}
                  </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
      </div>

      {/* 작업 배정 모달 */}
      {assignBoard ? (
        <div onClick={() => !saving && setAssignBoard(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(94vw, 560px)', maxHeight: '88vh', display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden', boxShadow: '0 12px 40px rgba(0,0,0,0.18)' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
                {BOARDS.find((x) => x.key === assignBoard)!.title} 작업 배정
              </h2>
              <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>
                {BOARDS.find((x) => x.key === assignBoard)!.flow} · 처리할 항목을 선택하세요.
              </p>
            </div>

            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 20px' }}>
              {assignPool.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--text-muted)', padding: '24px 0', textAlign: 'center' }}>배정할 대기 항목이 없습니다.</p>
              ) : (
                <div style={{ display: 'grid', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>대기 {assignPool.length}건</span>
                    <button type="button" onClick={() => setSelected((s) => s.size === assignPool.length ? new Set() : new Set(assignPool.map((i) => i.runId)))}
                      style={{ border: 0, background: 'transparent', fontSize: 12, fontWeight: 600, color: 'var(--accent)', cursor: 'pointer' }}>
                      {selected.size === assignPool.length ? '전체 해제' : '전체 선택'}
                    </button>
                  </div>
                  {assignPool.map((it) => {
                    const on = selected.has(it.runId);
                    return (
                      <label key={it.runId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`, background: on ? 'var(--accent-subtle)' : 'var(--bg)' }}>
                        <input type="checkbox" checked={on} onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(it.runId)) n.delete(it.runId); else n.add(it.runId); return n; })} style={{ width: 16, height: 16, flexShrink: 0 }} />
                        <StatusBadge category="blog" stage={it.stage} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {it.patientName || '—'}{it.ownerName ? <span style={{ fontWeight: 400, color: 'var(--text-secondary)' }}> · {it.ownerName}</span> : null}
                          </div>
                          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {it.hospitalName || '병원 미상'}{it.friendlyId ? ` · #${it.friendlyId}` : ''}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={{ borderTop: '1px solid var(--border)', padding: '12px 20px', display: 'grid', gap: 10 }}>
              {assignPool.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', maxHeight: 84, overflowY: 'auto' }}>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)' }}>병원별 선택</span>
                  {hospitalCounts.map((c) => (
                    <span key={c.h} title={`${c.h} — 선택 ${c.sel} / 가능 ${c.avail}`}
                      style={{ fontSize: 11.5, padding: '3px 9px', borderRadius: 999, border: `1px solid ${c.sel > 0 ? 'var(--accent)' : 'var(--border)'}`, background: c.sel > 0 ? 'var(--accent-subtle)' : 'var(--bg)', color: c.sel > 0 ? 'var(--accent)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {c.h} <b style={{ fontWeight: 800 }}>{c.sel}</b><span style={{ opacity: 0.7 }}>/{c.avail}</span>
                    </span>
                  ))}
                </div>
              ) : null}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <label style={{ display: 'grid', gap: 4, flex: '1 1 200px' }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>요청자</span>
                  <input value={requester} onChange={(e) => setRequester(e.target.value)} placeholder="이름 입력" style={inputStyle} />
                </label>
                <label style={{ display: 'grid', gap: 4, flex: '1 1 160px' }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>마감일</span>
                  <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={inputStyle} />
                </label>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" onClick={() => setAssignBoard(null)} disabled={saving}
                  style={{ padding: '9px 16px', fontSize: 13, fontWeight: 600, borderRadius: 6, background: '#fff', color: 'var(--text-secondary)', border: '1px solid var(--border-strong)', cursor: 'pointer' }}>취소</button>
                <button type="button" onClick={() => void submitAssign()} disabled={saving || selected.size === 0}
                  style={{ padding: '9px 20px', fontSize: 13, fontWeight: 700, borderRadius: 6, border: '1px solid var(--accent)', background: saving || selected.size === 0 ? 'var(--accent-subtle)' : 'var(--accent)', color: saving || selected.size === 0 ? 'var(--accent)' : '#fff', cursor: saving || selected.size === 0 ? 'not-allowed' : 'pointer' }}>
                  {saving ? '배정 중…' : `배정 (${selected.size})`}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const inputStyle: React.CSSProperties = { width: '100%', padding: '9px 11px', fontSize: 14, border: '1px solid var(--border-strong)', borderRadius: 8, outline: 'none', boxSizing: 'border-box' };
