'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { StatusBadge } from '@/components/status-badge';

// 작업 현황판 '작업 목록' 탭 — 팀장이 주 1회 블로그 작업을 배정하면 팀원이 보고 처리.
//  board 'blog_write': 요청·작성중 → 작성완료 / board 'blog_save': 작성완료 → 저장완료
//  배정은 '작업 배정' 모달에서 현재 풀 항목을 골라(요청자·마감일) 추가한다.
//  배정된 목록은 요청 날짜별로 묶여 히스토리로 남고, 작업이 진행돼 다음 단계로 가면 '완료'로 표시된다.

export type QueueItem = {
  runId: string;
  friendlyId: string | null;
  hospitalId: string | null;
  hospitalName: string | null;
  ownerName: string | null;
  patientName: string | null;
  stage: 'requested' | 'writing' | 'drafted' | 'saved' | 'done';
};

// 키워드 드롭다운 옵션 — 마지막 배정일 + 최신 순위(섹션) + 최신 검색량.
type KwOpt = { keyword: string; lastUsedAt: string | null; rank: number | null; rankSection: string | null; searchVolume: number | null };

type ReqDto = {
  id: string; runId: string; board: 'blog_write' | 'blog_save';
  requester: string; dueDate: string | null; keyword: string; keyword2?: string | null; sortOrder: number; createdAt: string;
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
// YYYY/MM/DD (4자리 연도) — 키워드 드롭다운 '마지막 사용 날짜' 표기용.
function fmtDateFull(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).replace(/-/g, '/');
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

  // 병원별 블로그 키워드 — '블로그 저장' 배정 시 케이스별 드롭다운 옵션. lastUsedAt = 마지막 배정 일시.
  const [kwByHospital, setKwByHospital] = useState<Record<string, KwOpt[]>>({});
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/work-board/blog-keywords', { credentials: 'include', cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) return;
        // 응답이 문자열 배열(구버전)이든 {keyword,lastUsedAt} 객체 배열이든 동일하게 정규화.
        const raw = (data.keywords ?? {}) as Record<string, unknown[]>;
        const norm: Record<string, KwOpt[]> = {};
        for (const [hid, arr] of Object.entries(raw)) {
          norm[hid] = (arr ?? []).map((e) => {
            if (typeof e === 'string') return { keyword: e, lastUsedAt: null, rank: null, rankSection: null, searchVolume: null };
            const o = e as { keyword?: unknown; lastUsedAt?: unknown; rank?: unknown; rankSection?: unknown; searchVolume?: unknown };
            const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
            return {
              keyword: String(o.keyword ?? ''),
              lastUsedAt: o.lastUsedAt != null ? String(o.lastUsedAt) : null,
              rank: n(o.rank),
              rankSection: o.rankSection != null ? String(o.rankSection) : null,
              searchVolume: n(o.searchVolume),
            };
          }).filter((o) => o.keyword);
        }
        setKwByHospital(norm);
      } catch { /* 키워드 미로딩 시 드롭다운만 비어 표시 */ }
    })();
  }, []);

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
  // runId → { kw1(필수), kw2(선택) } (blog_save 전용). 케이스 하나에 키워드 두 개까지 배정한다.
  const [keywords, setKeywords] = useState<Map<string, { kw1: string; kw2: string }>>(new Map());
  const setKw = (runId: string, which: 'kw1' | 'kw2', v: string) =>
    setKeywords((m) => {
      const n = new Map(m);
      const cur = n.get(runId) ?? { kw1: '', kw2: '' };
      n.set(runId, { ...cur, [which]: v });
      return n;
    });
  const [requester, setRequester] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [saving, setSaving] = useState(false);

  const openAssign = (board: Board) => { setAssignBoard(board); setSelected(new Set()); setKeywords(new Map()); setRequester(''); setDueDate(''); };

  const assignPool = useMemo(() => {
    if (!assignBoard) return [] as QueueItem[];
    const b = BOARDS.find((x) => x.key === assignBoard)!;
    return blogItems.filter((i) => b.poolStages.includes(i.stage) && !assignedByBoard[assignBoard].has(i.runId));
  }, [assignBoard, blogItems, assignedByBoard]);

  // 대기 목록을 병원별로 그루핑(건수 많은 병원 먼저, 동수면 이름순).
  const poolByHospital = useMemo(() => {
    const groups = new Map<string, QueueItem[]>();
    for (const it of assignPool) {
      const h = it.hospitalName?.trim() || '병원 미상';
      const arr = groups.get(h);
      if (arr) arr.push(it);
      else groups.set(h, [it]);
    }
    return [...groups.entries()]
      .map(([hospital, items]) => ({ hospital, items }))
      .sort((a, b) => b.items.length - a.items.length || a.hospital.localeCompare(b.hospital));
  }, [assignPool]);

  // 병원별 (선택수 / 가능수) — 팀장이 고르게 배정하도록 실시간 카운트.
  const hospitalCounts = useMemo(() => {
    const avail = new Map<string, number>();
    for (const it of assignPool) { const h = it.hospitalName?.trim() || '병원 미상'; avail.set(h, (avail.get(h) ?? 0) + 1); }
    const sel = new Map<string, number>();
    for (const id of selected) { const h = itemByRun.get(id)?.hospitalName?.trim() || '병원 미상'; sel.set(h, (sel.get(h) ?? 0) + 1); }
    return [...avail.entries()].map(([h, a]) => ({ h, avail: a, sel: sel.get(h) ?? 0 })).sort((x, y) => y.avail - x.avail || x.h.localeCompare(y.h));
  }, [assignPool, selected, itemByRun]);

  // blog_save 배정은 선택된 케이스마다 '첫 번째' 키워드 필수(두 번째는 선택) — 하나라도 비어 있으면 배정 불가.
  const missingKeywordCount = useMemo(() => {
    if (assignBoard !== 'blog_save') return 0;
    let n = 0;
    for (const id of selected) if (!(keywords.get(id)?.kw1?.trim())) n += 1;
    return n;
  }, [assignBoard, selected, keywords]);

  async function submitAssign() {
    if (!assignBoard || selected.size === 0 || missingKeywordCount > 0 || !requester.trim() || !dueDate) return;
    setSaving(true);
    try {
      // blog_save 는 케이스별 키워드도 함께 전송(선택된 항목만). kw1=필수, kw2=선택.
      const keywordPayload = assignBoard === 'blog_save'
        ? Object.fromEntries([...selected].map((id) => [id, keywords.get(id)?.kw1?.trim() ?? '']).filter(([, v]) => v))
        : undefined;
      const keyword2Payload = assignBoard === 'blog_save'
        ? Object.fromEntries([...selected].map((id) => [id, keywords.get(id)?.kw2?.trim() ?? '']).filter(([, v]) => v))
        : undefined;
      const res = await fetch('/api/admin/work-board/requests', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board: assignBoard, runIds: [...selected], requester, dueDate, keywords: keywordPayload, keywords2: keyword2Payload }),
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

  if (loading) return <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>불러오는 중…</p>;
  if (error) return <p style={{ fontSize: 14, color: 'var(--danger)' }}>{error}</p>;

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
              <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)' }}>{b.title}</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-muted)' }}>{b.flow}</span>
              <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>· 진행 중 {activeCount}건</span>
              <button type="button" onClick={() => openAssign(b.key)}
                style={{ marginLeft: 'auto', padding: '7px 14px', fontSize: 14, fontWeight: 700, borderRadius: 8, border: '1px solid var(--accent)', background: 'var(--accent)', color: '#fff', cursor: 'pointer' }}>
                + 작업 배정
              </button>
            </div>

            {dateKeys.length === 0 ? (
              <p style={{ fontSize: 14, color: 'var(--text-muted)', padding: '20px 0', textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 10 }}>
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
                      style={{ display: 'flex', alignItems: 'center', gap: 5, width: '100%', textAlign: 'left', border: 0, background: 'transparent', cursor: 'pointer', padding: 0, marginBottom: 8, fontSize: 14, fontWeight: 700, color: hdr.color, letterSpacing: '0.02em' }}>
                      <span style={{ display: 'inline-block', transition: 'transform .12s', transform: open ? 'rotate(90deg)' : 'none', fontSize: 11 }}>▶</span>
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
                              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {it?.patientName || '—'}{it?.ownerName ? <span style={{ fontWeight: 400, color: 'var(--text-secondary)' }}> · {it.ownerName}</span> : null}
                                {isDone ? <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: '#16a34a' }}>✓ 완료</span> : null}
                              </div>
                              <div style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {it?.hospitalName || '병원 미상'}{it?.friendlyId ? ` · #${it.friendlyId}` : ''}
                              </div>
                              <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 11 }}>
                                {r.keyword ? <span style={{ padding: '1px 7px', borderRadius: 999, background: 'var(--accent-subtle)', color: 'var(--accent)', fontWeight: 700 }}># {r.keyword}</span> : null}
                                {r.keyword2 ? <span style={{ padding: '1px 7px', borderRadius: 999, background: 'var(--bg-subtle)', color: 'var(--text-secondary)', fontWeight: 700 }}># {r.keyword2}</span> : null}
                                {r.requester ? <span style={{ color: 'var(--text-secondary)' }}>요청자 <b style={{ color: 'var(--text)' }}>{r.requester}</b></span> : null}
                                <span style={{ color: 'var(--text-muted)' }}>요청 {fmtDate(r.createdAt)}</span>
                              </div>
                            </div>
                            <button type="button" onClick={() => void removeReq(r.id)} title="목록에서 제거"
                              style={{ flexShrink: 0, border: 0, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: 2 }}>×</button>
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
            style={{ width: assignBoard === 'blog_save' ? 'min(97vw, 1240px)' : 'min(94vw, 560px)', maxHeight: '88vh', display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden', boxShadow: '0 12px 40px rgba(0,0,0,0.18)' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>
                {BOARDS.find((x) => x.key === assignBoard)!.title} 작업 배정
              </h2>
              <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--text-muted)' }}>
                {BOARDS.find((x) => x.key === assignBoard)!.flow} · 처리할 항목을 선택하세요.
              </p>
            </div>

            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 20px' }}>
              {assignPool.length === 0 ? (
                <p style={{ fontSize: 14, color: 'var(--text-muted)', padding: '24px 0', textAlign: 'center' }}>배정할 대기 항목이 없습니다.</p>
              ) : (
                <div style={{ display: 'grid', gap: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>대기 {assignPool.length}건 · {poolByHospital.length}개 병원</span>
                    <button type="button" onClick={() => setSelected((s) => s.size === assignPool.length ? new Set() : new Set(assignPool.map((i) => i.runId)))}
                      style={{ border: 0, background: 'transparent', fontSize: 14, fontWeight: 600, color: 'var(--accent)', cursor: 'pointer' }}>
                      {selected.size === assignPool.length ? '전체 해제' : '전체 선택'}
                    </button>
                  </div>
                  {poolByHospital.map(({ hospital, items }) => {
                    const runIds = items.map((i) => i.runId);
                    const allOn = runIds.every((id) => selected.has(id));
                    return (
                    <div key={hospital} style={{ display: 'grid', gap: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 2, borderTop: '1px solid var(--border)', marginTop: 2 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                          {hospital} <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{items.length}건</span>
                        </span>
                        <button type="button" onClick={() => setSelected((s) => { const n = new Set(s); if (allOn) runIds.forEach((id) => n.delete(id)); else runIds.forEach((id) => n.add(id)); return n; })}
                          style={{ border: 0, background: 'transparent', fontSize: 11, fontWeight: 600, color: 'var(--accent)', cursor: 'pointer' }}>
                          {allOn ? '해제' : '전체 선택'}
                        </button>
                      </div>
                      {items.map((it) => {
                    const on = selected.has(it.runId);
                    const isSave = assignBoard === 'blog_save';
                    return (
                      <div key={it.runId} style={{ display: 'flex', alignItems: 'stretch', borderRadius: 8, border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`, background: on ? 'var(--accent-subtle)' : 'var(--bg)', overflow: 'hidden' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', cursor: 'pointer', flex: isSave ? '3.5 1 0' : '1 1 0', minWidth: 0 }}>
                          <input type="checkbox" checked={on} onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(it.runId)) n.delete(it.runId); else n.add(it.runId); return n; })} style={{ width: 16, height: 16, flexShrink: 0 }} />
                          <StatusBadge category="blog" stage={it.stage} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {it.patientName || '—'}{it.ownerName ? <span style={{ fontWeight: 400, color: 'var(--text-secondary)' }}> · {it.ownerName}</span> : null}
                            </div>
                            {it.friendlyId ? (
                              <div style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                #{it.friendlyId}
                              </div>
                            ) : null}
                          </div>
                        </label>
                        {isSave ? (() => {
                          const opts = (it.hospitalId && kwByHospital[it.hospitalId]) || [];
                          const kw = keywords.get(it.runId) ?? { kw1: '', kw2: '' };
                          const empty1 = !kw.kw1.trim();
                          // 체크 여부와 무관하게 우측에 항상 노출 — 미선택 항목은 흐리게.
                          return (
                          <div style={{ display: 'flex', flex: '6.5 1 0', minWidth: 0, padding: '9px 11px', borderLeft: '1px dashed var(--border)', opacity: on ? 1 : 0.55 }}>
                            {opts.length === 0 ? (
                              <span style={{ fontSize: 11, color: on ? '#dc2626' : 'var(--text-muted)', lineHeight: 1.35 }}>이 병원에 등록된 블로그 키워드 없음 — 병원 관리 설정에서 추가</span>
                            ) : (
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, width: '100%' }}>
                                <div>
                                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 3 }}>키워드 1 <span style={{ color: '#dc2626' }}>*</span></div>
                                  <KeywordSelect
                                    options={opts}
                                    value={kw.kw1}
                                    invalid={on && empty1}
                                    onChange={(v) => setKw(it.runId, 'kw1', v)}
                                  />
                                </div>
                                <div>
                                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 3 }}>키워드 2 <span style={{ fontWeight: 500 }}>(선택)</span></div>
                                  <KeywordSelect
                                    options={opts}
                                    value={kw.kw2}
                                    placeholder="선택 안 함"
                                    clearable
                                    onChange={(v) => setKw(it.runId, 'kw2', v)}
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                          );
                        })() : null}
                      </div>
                    );
                  })}
                    </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={{ borderTop: '1px solid var(--border)', padding: '12px 20px', display: 'grid', gap: 10 }}>
              {assignPool.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', maxHeight: 84, overflowY: 'auto' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>병원별 선택</span>
                  {hospitalCounts.map((c) => (
                    <span key={c.h} title={`${c.h} — 선택 ${c.sel} / 가능 ${c.avail}`}
                      style={{ fontSize: 11, padding: '3px 9px', borderRadius: 999, border: `1px solid ${c.sel > 0 ? 'var(--accent)' : 'var(--border)'}`, background: c.sel > 0 ? 'var(--accent-subtle)' : 'var(--bg)', color: c.sel > 0 ? 'var(--accent)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {c.h} <b style={{ fontWeight: 800 }}>{c.sel}</b><span style={{ opacity: 0.7 }}>/{c.avail}</span>
                    </span>
                  ))}
                </div>
              ) : null}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <label style={{ display: 'grid', gap: 4, flex: '1 1 200px' }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>요청자 <span style={{ color: '#dc2626' }}>*</span></span>
                  <input value={requester} onChange={(e) => setRequester(e.target.value)} placeholder="이름 입력(필수)" style={{ ...inputStyle, borderColor: selected.size > 0 && !requester.trim() ? '#dc2626' : 'var(--border-strong)' }} />
                </label>
                <label style={{ display: 'grid', gap: 4, flex: '1 1 160px' }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>마감일 <span style={{ color: '#dc2626' }}>*</span></span>
                  <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={{ ...inputStyle, borderColor: selected.size > 0 && !dueDate ? '#dc2626' : 'var(--border-strong)' }} />
                </label>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8 }}>
                {(() => {
                  const msgs: string[] = [];
                  if (selected.size > 0 && !requester.trim()) msgs.push('요청자');
                  if (selected.size > 0 && !dueDate) msgs.push('마감일');
                  if (missingKeywordCount > 0) msgs.push(`키워드 ${missingKeywordCount}건`);
                  return msgs.length > 0 ? (
                    <span style={{ marginRight: 'auto', fontSize: 11, fontWeight: 600, color: '#dc2626' }}>{msgs.join(' · ')} 입력 필요</span>
                  ) : null;
                })()}
                <button type="button" onClick={() => setAssignBoard(null)} disabled={saving}
                  style={{ padding: '9px 16px', fontSize: 14, fontWeight: 600, borderRadius: 6, background: '#fff', color: 'var(--text-secondary)', border: '1px solid var(--border-strong)', cursor: 'pointer' }}>취소</button>
                {(() => { const off = saving || selected.size === 0 || missingKeywordCount > 0 || !requester.trim() || !dueDate; return (
                <button type="button" onClick={() => void submitAssign()} disabled={off}
                  style={{ padding: '9px 20px', fontSize: 14, fontWeight: 700, borderRadius: 6, border: '1px solid var(--accent)', background: off ? 'var(--accent-subtle)' : 'var(--accent)', color: off ? 'var(--accent)' : '#fff', cursor: off ? 'not-allowed' : 'pointer' }}>
                  {saving ? '배정 중…' : `배정 (${selected.size})`}
                </button>
                ); })()}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const inputStyle: React.CSSProperties = { width: '100%', padding: '9px 11px', fontSize: 14, border: '1px solid var(--border-strong)', borderRadius: 8, outline: 'none', boxSizing: 'border-box' };

// 키워드 커스텀 드롭다운 — 네이티브 select 로는 옵션 안에서 날짜 우측정렬·italic 이 불가해 직접 구현.
//  옵션/선택 표시 모두 [키워드 …왼쪽] [마지막 사용 날짜 — 우측정렬·진회색·italic] 레이아웃.
//  팝업은 모달의 overflow/opacity 에 안 잘리도록 body 로 포털 + fixed 좌표 배치.
function KeywordSelect({ options, value, invalid = false, onChange, placeholder = '키워드 선택 *', clearable = false }: {
  options: KwOpt[];
  value: string;
  invalid?: boolean;
  onChange: (v: string) => void;
  placeholder?: string;
  /** 선택 안 함으로 되돌릴 수 있게(두 번째 키워드용). */
  clearable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const recompute = () => { const el = btnRef.current; if (el) { const r = el.getBoundingClientRect(); setRect({ left: r.left, top: r.bottom + 4, width: r.width }); } };
    recompute();
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !popRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('scroll', recompute, true);
    window.addEventListener('resize', recompute);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', recompute, true);
      window.removeEventListener('resize', recompute);
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const dateText = (o: string | null) => (o ? fmtDateFull(o) : '없음');
  const selDate = value ? dateText(options.find((o) => o.keyword === value)?.lastUsedAt ?? null) : '';
  const rankText = (rank: number | null, section: string | null) => (rank != null ? `${rank}위${section ? ` (${section})` : ''}` : '—');
  const volText = (v: number | null) => (v != null ? `${v.toLocaleString('ko-KR')}회` : '—');
  // 순위·검색량·마지막 사용일 3종 메타를 한 줄로. 좁으면 줄여서.
  const metaRow = (o: KwOpt) => (
    <span style={{ flexShrink: 0, display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 11 }}>
      <span style={{ fontWeight: 700, color: o.rank != null ? 'var(--accent)' : 'var(--text-muted)' }} title="가장 최근 수집 최상위 순위">{rankText(o.rank, o.rankSection)}</span>
      <span style={{ color: 'var(--text-secondary)' }} title="최신 월간 검색량">🔍 {volText(o.searchVolume)}</span>
      <span style={{ fontStyle: 'italic', fontWeight: 600, color: '#4b5563' }} title="마지막 배정일">{dateText(o.lastUsedAt)}</span>
    </span>
  );

  return (
    <>
      <button ref={btnRef} type="button" onClick={() => setOpen((o) => !o)}
        style={{ width: '100%', minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '6px 9px', fontSize: 14, border: `1px solid ${invalid ? '#dc2626' : 'var(--border-strong)'}`, borderRadius: 6, background: '#fff', cursor: 'pointer', textAlign: 'left', boxSizing: 'border-box' }}>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: value ? 'var(--text)' : 'var(--text-muted)' }}>
          {value || placeholder}
        </span>
        {value ? <span style={{ flexShrink: 0, fontStyle: 'italic', fontWeight: 600, color: '#4b5563', fontSize: 11 }}>{selDate}</span> : null}
        <span style={{ flexShrink: 0, fontSize: 11, color: 'var(--text-muted)' }}>▼</span>
      </button>
      {open && rect
        ? createPortal(
            <div ref={popRef}
              style={{ position: 'fixed', left: rect.left, top: rect.top, width: Math.max(rect.width, 300), maxHeight: 260, overflowY: 'auto', background: '#fff', border: '1px solid var(--border-strong)', borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,0.16)', zIndex: 1100, padding: 4 }}>
              {clearable ? (
                <button type="button" onClick={() => { onChange(''); setOpen(false); }}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', padding: '7px 8px', border: 0, background: !value ? 'var(--accent-subtle)' : 'transparent', borderRadius: 4, cursor: 'pointer', textAlign: 'left', fontSize: 14, color: 'var(--text-muted)' }}>
                  선택 안 함
                </button>
              ) : null}
              {options.map((o) => (
                <button key={o.keyword} type="button" onClick={() => { onChange(o.keyword); setOpen(false); }}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', border: 0, background: o.keyword === value ? 'var(--accent-subtle)' : 'transparent', borderRadius: 4, cursor: 'pointer', textAlign: 'left' }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14, color: 'var(--text)' }}>{o.keyword}</span>
                  {metaRow(o)}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
