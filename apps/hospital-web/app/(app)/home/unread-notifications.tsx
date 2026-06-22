'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight } from 'lucide-react';

type Noti = { id: string; type: string; title: string; body: string | null; link: string | null; read: boolean; created_at: string };

// 주의를 요하는 알림은 제목을 경고색으로 표시(아이콘 없이 색으로만 구분)
const WARN_TYPES = new Set(['token_low', 'plan_expiring']);

function ago(iso: string): string {
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

export function UnreadNotifications() {
  const router = useRouter();
  const [items, setItems] = useState<Noti[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications', { credentials: 'include' });
      if (!res.ok) return;
      const data = (await res.json()) as { notifications?: Noti[] };
      setItems((data.notifications ?? []).filter((n) => !n.read));
    } catch { /* noop */ } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60000); // 1분마다 갱신
    return () => clearInterval(t);
  }, [load]);

  const markAll = async () => {
    setItems([]);
    await fetch('/api/notifications', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  };
  const onClick = async (n: Noti) => {
    setItems((a) => a.filter((x) => x.id !== n.id));
    await fetch('/api/notifications', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: n.id }) });
    // 토큰 부족 알림만 → 설정의 토큰 관리(충전)로. 지급 완료 등은 읽음 처리만.
    if (n.type === 'token_low') {
      window.dispatchEvent(new CustomEvent('hospital:open-settings', { detail: { tab: 'usage' } }));
    } else if (n.link) {
      router.push(n.link);
    }
  };

  // 로딩 전에는 깜빡임 방지를 위해 숨김
  if (!loaded) return null;

  // 안읽음이 없으면 칸은 유지하고 "모두 확인" 메시지를 표시
  if (items.length === 0) {
    return (
      <section style={{ marginBottom: 28, borderRadius: 'var(--radius-lg)', border: '1px solid var(--accent)', background: 'var(--bg)', boxShadow: '0 6px 18px var(--accent-subtle)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '18px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>읽지 않은 알림이 없어요</div>
            <p style={{ margin: '3px 0 0', fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.45 }}>새 소식은 여기와 상단 종 아이콘에서 확인할 수 있어요.</p>
          </div>
        </div>
      </section>
    );
  }

  const visible = items.slice(0, 5);
  const more = items.length - visible.length;

  return (
    <section style={{ marginBottom: 28, borderRadius: 'var(--radius-lg)', border: '1px solid var(--accent)', background: 'var(--bg)', overflow: 'hidden', boxShadow: '0 6px 18px var(--accent-subtle)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--border)', background: 'var(--accent-subtle)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>읽지 않은 알림</span>
          <span style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999, background: 'var(--danger)', color: '#fff', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
            {items.length > 99 ? '99+' : items.length}
          </span>
        </div>
        <button type="button" onClick={() => void markAll()} style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer' }}>모두 읽음</button>
      </div>
      <div>
        {visible.map((n) => {
          const warn = WARN_TYPES.has(n.type);
          return (
            <button key={n.id} type="button" onClick={() => void onClick(n)}
              className="homeCard"
              style={{ display: 'flex', alignItems: 'flex-start', gap: 12, width: '100%', textAlign: 'left', padding: '13px 18px', border: 'none', borderBottom: '1px solid var(--border)', borderRadius: 0, background: 'transparent', cursor: 'pointer' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700, color: warn ? 'var(--danger)' : 'var(--text)' }}>{n.title}</span>
                  <span style={{ flexShrink: 0, fontSize: 11, color: 'var(--text-muted)' }}>{ago(n.created_at)}</span>
                </div>
                {n.body && <p style={{ margin: '3px 0 0', fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.45, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{n.body}</p>}
              </div>
              {(n.link || n.type === 'token_low') && <ChevronRight size={16} className="homeArrow" style={{ flexShrink: 0, marginTop: 3 }} />}
            </button>
          );
        })}
      </div>
      {more > 0 && (
        <div style={{ padding: '10px 18px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
          외 {more}개의 읽지 않은 알림이 더 있어요
        </div>
      )}
    </section>
  );
}
