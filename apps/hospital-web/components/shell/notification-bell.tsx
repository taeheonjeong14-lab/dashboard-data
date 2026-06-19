'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell } from 'lucide-react';

type Noti = { id: string; type: string; title: string; body: string | null; link: string | null; read: boolean; created_at: string };

function ago(iso: string): string {
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Noti[]>([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications', { credentials: 'include' });
      if (!res.ok) return;
      const data = (await res.json()) as { notifications?: Noti[]; unread?: number };
      setItems(data.notifications ?? []);
      setUnread(data.unread ?? 0);
    } catch { /* noop */ }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60000); // 1분마다 갱신
    return () => clearInterval(t);
  }, [load]);

  // 바깥 클릭 닫기
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const markAll = async () => {
    await fetch('/api/notifications', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    setItems((a) => a.map((n) => ({ ...n, read: true })));
    setUnread(0);
  };
  const onClick = async (n: Noti) => {
    if (!n.read) {
      await fetch('/api/notifications', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: n.id }) });
      setUnread((u) => Math.max(0, u - 1));
      setItems((a) => a.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    }
    setOpen(false);
    if (n.link) router.push(n.link);
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => { setOpen((o) => !o); if (!open) void load(); }}
        title="알림"
        style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 'var(--radius)', color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}
      >
        <Bell size={16} />
        {unread > 0 && (
          <span style={{ position: 'absolute', top: -2, right: -2, minWidth: 16, height: 16, padding: '0 4px', borderRadius: 999, background: 'var(--danger)', color: '#fff', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div style={{ position: 'absolute', top: 38, right: 0, width: 340, maxHeight: 440, display: 'flex', flexDirection: 'column', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: '0 8px 28px rgba(0,0,0,0.16)', overflow: 'hidden', zIndex: 100 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>알림</span>
            {unread > 0 && <button type="button" onClick={() => void markAll()} style={{ fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer' }}>모두 읽음</button>}
          </div>
          <div style={{ overflowY: 'auto' }}>
            {items.length === 0 ? (
              <p style={{ margin: 0, padding: '28px 14px', fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>알림이 없습니다.</p>
            ) : (
              items.map((n) => (
                <button key={n.id} type="button" onClick={() => void onClick(n)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '11px 14px', border: 'none', borderBottom: '1px solid var(--border)', background: n.read ? 'transparent' : 'var(--accent-subtle)', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: n.read ? 500 : 700, color: 'var(--text)' }}>{n.title}</span>
                    <span style={{ flexShrink: 0, fontSize: 11, color: 'var(--text-muted)' }}>{ago(n.created_at)}</span>
                  </div>
                  {n.body && <div style={{ marginTop: 3, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4 }}>{n.body}</div>}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
