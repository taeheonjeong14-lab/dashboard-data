'use client';

import { useCallback, useEffect, useState } from 'react';

type Order = {
  id: string; order_no: string; hospital_id: string; hospital_name: string | null;
  base_tokens: number; bonus_tokens: number; total_tokens: number; price_krw: number;
  status: string; created_at: string; paid_at: string | null;
};

const won = (v: number) => Number(v).toLocaleString('ko-KR');
const tok = (v: number) => Number(v).toLocaleString('ko-KR');
const dt = (s: string | null) => (s ? new Date(s).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '-');
const STATUS: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: '입금 대기', color: '#b45309', bg: '#fef3c7' },
  paid: { label: '충전 완료', color: '#15803d', bg: '#dcfce7' },
  canceled: { label: '취소', color: '#6b7280', bg: '#f3f4f6' },
};

export function AdminTokenOrders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/token-orders');
      const d = (await res.json()) as { orders?: Order[] };
      if (res.ok) setOrders(d.orders ?? []);
    } catch { /* noop */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function confirmOrder(o: Order) {
    if (!window.confirm(`${o.hospital_name ?? o.hospital_id}\n${tok(o.total_tokens)}토큰 (${won(o.price_krw)}원)\n\n입금을 확인하고 토큰을 지급할까요?`)) return;
    setBusy(o.id); setMsg(null);
    try {
      const res = await fetch('/api/admin/token-orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: o.id }),
      });
      const d = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !d.success) { setMsg({ ok: false, text: `처리 실패: ${d.error ?? ''}` }); return; }
      setMsg({ ok: true, text: `${o.order_no} 충전 완료 (${tok(o.total_tokens)}토큰)` });
      await load();
    } catch {
      setMsg({ ok: false, text: '네트워크 오류가 발생했습니다.' });
    } finally {
      setBusy(null);
    }
  }

  const pendingCount = orders.filter((o) => o.status === 'pending').length;

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '4px 2px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>토큰 구매 주문</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 3 }}>
            입금 대기 <b style={{ color: pendingCount ? '#b45309' : 'var(--text-muted)' }}>{pendingCount}</b>건 · 입금 확인 후 “입금 확인 완료”를 누르면 토큰이 지급됩니다.
          </div>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading}
          style={{ padding: '7px 13px', fontSize: 12.5, fontWeight: 700, borderRadius: 8, border: '1px solid var(--border-strong)', background: '#fff', color: 'var(--text-secondary)', cursor: 'pointer' }}>
          새로고침
        </button>
      </div>

      {msg ? (
        <p style={{ margin: '0 0 12px', fontSize: 13, padding: '8px 12px', borderRadius: 8, background: msg.ok ? '#dcfce7' : '#fee2e2', color: msg.ok ? '#15803d' : '#b91c1c' }}>{msg.text}</p>
      ) : null}

      {loading && orders.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>불러오는 중…</p>
      ) : orders.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>주문이 없습니다.</p>
      ) : (
        <div style={{ border: '1px solid var(--border-strong)', borderRadius: 12, overflow: 'hidden' }}>
          {orders.map((o, i) => {
            const st = STATUS[o.status] ?? { label: o.status, color: '#6b7280', bg: '#f3f4f6' };
            return (
              <div key={o.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                padding: '13px 16px', borderTop: i ? '1px solid var(--border)' : 'none',
                background: o.status === 'pending' ? '#fffdf5' : '#fff',
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                    {o.hospital_name ?? '(병원 미상)'}
                    <span style={{ marginLeft: 8, fontSize: 11.5, fontWeight: 700, color: st.color, background: st.bg, padding: '2px 8px', borderRadius: 999 }}>{st.label}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 3 }}>
                    {tok(o.base_tokens)}{o.bonus_tokens > 0 ? <span style={{ color: 'var(--accent)' }}> + {tok(o.bonus_tokens)}</span> : null} 토큰 · <b style={{ color: 'var(--text)' }}>{won(o.price_krw)}원</b>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    #{o.order_no} · 주문 {dt(o.created_at)}{o.paid_at ? ` · 충전 ${dt(o.paid_at)}` : ''}
                  </div>
                </div>
                {o.status === 'pending' ? (
                  <button type="button" onClick={() => void confirmOrder(o)} disabled={busy === o.id}
                    style={{ flexShrink: 0, padding: '9px 14px', fontSize: 13, fontWeight: 700, color: '#fff', background: busy === o.id ? 'var(--text-muted)' : 'var(--accent)', border: 'none', borderRadius: 8, cursor: busy === o.id ? 'default' : 'pointer' }}>
                    {busy === o.id ? '처리 중…' : '입금 확인 완료'}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
