'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';

const STEPS = [
  { key: 'blog_metrics', label: '블로그 일별 지표' },
  { key: 'smartplace', label: '스마트플레이스 유입' },
  { key: 'keyword_rank', label: '키워드 순위' },
  { key: 'searchad', label: 'SearchAd 성과' },
  { key: 'place_reviews', label: '리뷰 추이' },
] as const;
const STEP_LABEL: Record<string, string> = Object.fromEntries(STEPS.map((s) => [s.key, s.label]));
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

type HospitalOpt = { id: string; name_ko?: string | null };
type Schedule = {
  id: string;
  label: string;
  enabled: boolean;
  steps: string[] | null;
  scope: 'all' | 'hospitals';
  hospital_ids: string[] | null;
  frequency: 'daily' | 'weekly';
  hour: number;
  weekdays: number[] | null;
  last_fired_at: string | null;
};

type Draft = {
  label: string;
  steps: string[];
  scope: 'all' | 'hospitals';
  hospitalIds: string[];
  frequency: 'daily' | 'weekly';
  hour: number;
  weekdays: number[];
};

const emptyDraft = (): Draft => ({ label: '', steps: [], scope: 'all', hospitalIds: [], frequency: 'daily', hour: 5, weekdays: [1, 3, 5] });

function scheduleSummary(s: Schedule, hospitals: HospitalOpt[]): string {
  const steps = !s.steps || s.steps.length === 0 ? '전체 항목' : s.steps.map((k) => STEP_LABEL[k] ?? k).join(', ');
  const days = (s.weekdays ?? []).slice().sort().map((w) => WEEKDAYS[w]).join('');
  const when = s.frequency === 'weekly' ? `매주 ${days || '—'} ${s.hour}시` : `매일 ${s.hour}시`;
  const scope = s.scope === 'all'
    ? '전체 병원'
    : `${s.hospital_ids?.length ?? 0}개 병원`;
  void hospitals;
  return `${when} · ${scope} · ${steps}`;
}

export default function AdminCollectScheduler({
  hospitals,
  open = false,
  onClose,
  inline = false,
}: {
  hospitals: HospitalOpt[];
  open?: boolean;
  onClose?: () => void;
  inline?: boolean;
}) {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null); // 'new' = 새 항목
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/collect/schedules', { credentials: 'include' });
      const data = (await res.json()) as { schedules?: Schedule[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? '불러오기 실패');
      setSchedules(data.schedules ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '불러오기 실패');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (open || inline) void load(); }, [open, inline, load]);

  const startNew = () => { setDraft(emptyDraft()); setEditingId('new'); };
  const startEdit = (s: Schedule) => {
    setDraft({
      label: s.label, steps: s.steps ?? [], scope: s.scope, hospitalIds: s.hospital_ids ?? [],
      frequency: s.frequency, hour: s.hour, weekdays: (s.weekdays && s.weekdays.length > 0) ? s.weekdays : [1, 3, 5],
    });
    setEditingId(s.id);
  };

  const toggleStep = (k: string) =>
    setDraft((d) => ({ ...d, steps: d.steps.includes(k) ? d.steps.filter((x) => x !== k) : [...d.steps, k] }));
  const toggleHospital = (id: string) =>
    setDraft((d) => ({ ...d, hospitalIds: d.hospitalIds.includes(id) ? d.hospitalIds.filter((x) => x !== id) : [...d.hospitalIds, id] }));
  const toggleWeekday = (w: number) =>
    setDraft((d) => ({ ...d, weekdays: d.weekdays.includes(w) ? d.weekdays.filter((x) => x !== w) : [...d.weekdays, w].sort() }));

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        label: draft.label,
        steps: draft.steps,
        scope: draft.scope,
        hospitalIds: draft.hospitalIds,
        frequency: draft.frequency,
        hour: draft.hour,
        weekdays: draft.weekdays,
      };
      const url = editingId === 'new' ? '/api/admin/collect/schedules' : `/api/admin/collect/schedules/${editingId}`;
      const method = editingId === 'new' ? 'POST' : 'PATCH';
      const res = await fetch(url, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error((d as { error?: string }).error ?? '저장 실패'); }
      setEditingId(null);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : '저장 실패');
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (s: Schedule) => {
    await fetch(`/api/admin/collect/schedules/${s.id}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !s.enabled }) });
    await load();
  };
  const remove = async (s: Schedule) => {
    if (!window.confirm(`이 스케줄을 삭제할까요?\n(${scheduleSummary(s, hospitals)})`)) return;
    await fetch(`/api/admin/collect/schedules/${s.id}`, { method: 'DELETE', credentials: 'include' });
    await load();
  };

  if (!inline && !open) return null;

  const body = (
    <div style={{ padding: 16, display: 'grid', gap: 12, overflowY: 'auto' }}>
          {error && <div style={{ fontSize: 14, color: 'var(--danger)' }}>{error}</div>}

          {/* 목록 */}
          {loading ? (
            <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)' }}>불러오는 중…</p>
          ) : schedules.length === 0 ? (
            <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)' }}>등록된 스케줄이 없습니다.</p>
          ) : (
            <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
              {schedules.map((s, i) => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderTop: i ? '1px solid var(--border)' : 'none', opacity: s.enabled ? 1 : 0.55 }}>
                  <input type="checkbox" checked={s.enabled} onChange={() => void toggleEnabled(s)} title="활성/비활성" />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{s.label || '(이름 없음)'}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{scheduleSummary(s, hospitals)}</div>
                  </div>
                  <button type="button" onClick={() => startEdit(s)} style={miniBtn}>수정</button>
                  <button type="button" onClick={() => void remove(s)} style={{ ...miniBtn, color: 'var(--danger)', borderColor: 'var(--danger-subtle)' }}>삭제</button>
                </div>
              ))}
            </div>
          )}

          {editingId == null ? (
            <button type="button" onClick={startNew} style={{ ...miniBtn, alignSelf: 'flex-start', borderColor: 'var(--accent)', color: 'var(--accent)' }}>+ 새 스케줄</button>
          ) : (
            <div style={{ border: '1px solid var(--accent)', borderRadius: 8, padding: 12, display: 'grid', gap: 12, background: 'var(--bg)' }}>
              <div>
                <div style={lbl}>이름</div>
                <input value={draft.label} onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))} placeholder="예: 매일 새벽 전체 수집" style={field} />
              </div>

              <div>
                <div style={lbl}>수집 항목 <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(미선택 = 전체)</span></div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {STEPS.map((st) => (
                    <button key={st.key} type="button" onClick={() => toggleStep(st.key)} style={chip(draft.steps.includes(st.key))}>{st.label}</button>
                  ))}
                </div>
              </div>

              <div>
                <div style={lbl}>대상</div>
                <div style={{ display: 'flex', gap: 6, marginBottom: draft.scope === 'hospitals' ? 8 : 0 }}>
                  <button type="button" onClick={() => setDraft((d) => ({ ...d, scope: 'all' }))} style={chip(draft.scope === 'all')}>전체 병원</button>
                  <button type="button" onClick={() => setDraft((d) => ({ ...d, scope: 'hospitals' }))} style={chip(draft.scope === 'hospitals')}>지정 병원</button>
                </div>
                {draft.scope === 'hospitals' && (
                  <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6, padding: 6, display: 'grid', gap: 2 }}>
                    {hospitals.map((h) => (
                      <label key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, padding: '2px 4px', cursor: 'pointer' }}>
                        <input type="checkbox" checked={draft.hospitalIds.includes(h.id)} onChange={() => toggleHospital(h.id)} />
                        {h.name_ko ?? h.id}
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div>
                  <div style={lbl}>주기</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" onClick={() => setDraft((d) => ({ ...d, frequency: 'daily' }))} style={chip(draft.frequency === 'daily')}>매일</button>
                    <button type="button" onClick={() => setDraft((d) => ({ ...d, frequency: 'weekly' }))} style={chip(draft.frequency === 'weekly')}>요일 지정</button>
                  </div>
                </div>
                <div>
                  <div style={lbl}>시각 (KST)</div>
                  <select value={draft.hour} onChange={(e) => setDraft((d) => ({ ...d, hour: Number(e.target.value) }))} style={field}>
                    {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                  </select>
                </div>
              </div>
              {draft.frequency === 'weekly' && (
                <div>
                  <div style={lbl}>요일 <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(여러 개 선택, 예: 월·수·금)</span></div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {WEEKDAYS.map((w, i) => (
                      <button key={i} type="button" onClick={() => toggleWeekday(i)} style={{ ...chip(draft.weekdays.includes(i)), padding: '6px 12px', borderRadius: 8 }}>{w}</button>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" onClick={() => setEditingId(null)} style={miniBtn}>취소</button>
                <button type="button" onClick={() => void save()} disabled={saving}
                  style={{ ...miniBtn, background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)', opacity: saving ? 0.6 : 1 }}>
                  {saving ? '저장 중…' : '저장'}
                </button>
              </div>
            </div>
          )}

          <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            매시 정각에 해당 시각의 스케줄이 수집 잡으로 자동 생성되고, 워커가 실행합니다. (전체 병원은 배치 1건)
          </p>
        </div>
  );

  if (inline) {
    return (
      <div style={{ maxWidth: 640 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>
          자동 수집 스케줄 {schedules.length > 0 ? `(${schedules.length})` : ''}
        </h2>
        <p style={{ margin: '0 0 6px', fontSize: 14, color: 'var(--text-muted)' }}>
          지정한 시각마다 자동으로 데이터를 수집합니다. 결과는 &lsquo;수집 내역&rsquo; 탭에서 확인할 수 있어요.
        </p>
        {body}
      </div>
    );
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(92vw, 560px)', maxHeight: '88vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: '0 12px 40px rgba(0,0,0,0.18)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>⏱ 자동 수집 스케줄 {schedules.length > 0 ? `(${schedules.length})` : ''}</h2>
          <button type="button" onClick={onClose} aria-label="닫기" style={{ border: 0, background: 'transparent', fontSize: 20, lineHeight: 1, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
        </div>
        {body}
      </div>
    </div>
  );
}

const lbl: CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 5 };
const field: CSSProperties = { padding: '7px 9px', fontSize: 14, border: '1px solid var(--border-strong)', borderRadius: 6, background: 'var(--bg)', color: 'var(--text)', outline: 'none', width: '100%', boxSizing: 'border-box' };
const miniBtn: CSSProperties = { flexShrink: 0, padding: '5px 11px', fontSize: 14, fontWeight: 700, borderRadius: 6, cursor: 'pointer', border: '1px solid var(--border-strong)', background: '#fff', color: 'var(--text-secondary)' };
function chip(on: boolean): CSSProperties {
  return { padding: '5px 11px', fontSize: 14, fontWeight: 700, borderRadius: 999, cursor: 'pointer', border: `1px solid ${on ? 'var(--accent)' : 'var(--border-strong)'}`, background: on ? 'var(--accent-subtle)' : '#fff', color: on ? 'var(--accent)' : 'var(--text-secondary)' };
}
