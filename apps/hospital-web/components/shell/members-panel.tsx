'use client';

import { useCallback, useEffect, useState } from 'react';

type Member = {
  id: string;
  email: string | null;
  name: string | null;
  phone: string | null;
  hospital_role: string | null;
  staff_approved: boolean;
  rejected: boolean;
  createdAt: string;
};

function roleLabel(m: Member): { text: string; color: string } {
  if (m.hospital_role === 'master') return { text: 'Master', color: 'var(--accent)' };
  if (m.rejected) return { text: '거절됨', color: 'var(--danger)' };
  if (m.staff_approved) return { text: 'Staff', color: 'var(--text-secondary)' };
  return { text: '승인 대기', color: 'var(--warning)' };
}

export function MembersPanel() {
  const [members, setMembers] = useState<Member[]>([]);
  const [myId, setMyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/members', { credentials: 'include' });
      const data = (await res.json()) as { members?: Member[]; myUserId?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? '불러오기 실패');
      setMembers(data.members ?? []);
      setMyId(data.myUserId ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '불러오기 실패');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const act = async (id: string, action: 'approve' | 'reject' | 'remove') => {
    if (action === 'remove' && !window.confirm('이 멤버를 병원에서 제외할까요? (재가입 가능)')) return;
    setBusy(id);
    try {
      const res = await fetch(`/api/members/${id}`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? '처리 실패');
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : '처리 실패');
    } finally {
      setBusy(null);
    }
  };

  const pending = members.filter((m) => m.hospital_role === 'staff' && !m.staff_approved && !m.rejected);
  const active = members.filter((m) => m.hospital_role === 'master' || (m.hospital_role === 'staff' && m.staff_approved));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>승인 대기 ({pending.length})</div>
        {loading ? (
          <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)' }}>불러오는 중…</p>
        ) : error ? (
          <p style={{ margin: 0, fontSize: 14, color: 'var(--danger)' }}>{error}</p>
        ) : pending.length === 0 ? (
          <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)' }}>승인 대기 중인 스태프가 없습니다.</p>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {pending.map((m) => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{m.name || '이름 미입력'}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m.email}{m.phone ? ` · ${m.phone}` : ''}</div>
                </div>
                <button type="button" disabled={busy === m.id} onClick={() => void act(m.id, 'approve')}
                  style={{ padding: '6px 12px', fontSize: 14, fontWeight: 700, borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer' }}>승인</button>
                <button type="button" disabled={busy === m.id} onClick={() => void act(m.id, 'reject')}
                  style={{ padding: '6px 12px', fontSize: 14, fontWeight: 700, borderRadius: 6, border: '1px solid var(--danger)', background: '#fff', color: 'var(--danger)', cursor: 'pointer' }}>거절</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>멤버 ({active.length})</div>
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
          {active.map((m, i) => {
            const rl = roleLabel(m);
            return (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderTop: i ? '1px solid var(--border)' : 'none' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                    {m.name || '이름 미입력'}
                    <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: rl.color }}>{rl.text}</span>
                    {m.id === myId ? <span style={{ marginLeft: 4, fontSize: 11, color: 'var(--text-muted)' }}>(나)</span> : null}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m.email}</div>
                </div>
                {m.hospital_role === 'staff' && m.id !== myId ? (
                  <button type="button" disabled={busy === m.id} onClick={() => void act(m.id, 'remove')}
                    style={{ padding: '5px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: '1px solid var(--border-strong)', background: '#fff', color: 'var(--text-secondary)', cursor: 'pointer' }}>제외</button>
                ) : null}
              </div>
            );
          })}
        </div>
        <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          스태프 초대는 가입 페이지에서 병원을 검색해 가입 → 여기서 승인하는 방식입니다.
        </p>
      </div>
    </div>
  );
}
