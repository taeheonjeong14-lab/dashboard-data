'use client';

import { useCallback, useEffect, useState } from 'react';

type Product = {
  code: string; name: string; price_tokens: number | null;
  status: string | null; currentPeriodEnd: string | null; autoRenew: boolean | null;
};
type Status = { barun: boolean; balance: number | null; products: Product[] };

const fmt = (n: number | null | undefined) => (n == null ? '-' : Math.round(n).toLocaleString());
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' }) : '';

export function SubscriptionPanel() {
  const [data, setData] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/subscriptions', { credentials: 'include' });
      const d = (await res.json()) as Status;
      if (res.ok) setData(d);
    } catch { /* noop */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (productCode: string, action: 'subscribe' | 'cancel') => {
    if (action === 'cancel' && !confirm('구독을 취소할까요? 이미 결제한 기간까지는 계속 이용할 수 있어요.')) return;
    if (action === 'subscribe') {
      const prod = data?.products.find((p) => p.code === productCode);
      const name = prod?.name ?? '운영 패키지';
      const priceTxt = prod?.price_tokens != null ? `${fmt(prod.price_tokens)}토큰` : '';
      const balTxt = data?.balance != null ? `현재 잔액 ${fmt(data.balance)}토큰. ` : '';
      if (!confirm(
        `${name}을(를) 구독할까요?\n\n` +
        `지금 첫 결제로 ${priceTxt}이 즉시 차감되고, 이후 매월 ${priceTxt}이 자동 결제됩니다.\n` +
        `${balTxt}언제든 취소할 수 있으며, 취소해도 이미 결제한 기간까지는 계속 이용할 수 있어요.`
      )) return;
    }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch('/api/subscriptions', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productCode, action }),
      });
      const d = (await res.json()) as { result?: string; error?: string };
      const r = d.result;
      if (!res.ok) setMsg({ type: 'error', text: d.error ?? '처리에 실패했습니다.' });
      else if (r === 'ok') { setMsg({ type: 'success', text: action === 'cancel' ? '구독을 취소했습니다. 기간 종료까지 계속 이용할 수 있어요.' : '구독이 시작되었습니다.' }); await load(); }
      else if (r === 'insufficient') setMsg({ type: 'error', text: '토큰 잔액이 부족합니다. 충전 후 다시 시도해 주세요.' });
      else if (r === 'not_master') setMsg({ type: 'error', text: '구독 변경은 마스터만 가능합니다.' });
      else if (r === 'exists') setMsg({ type: 'error', text: '이미 구독 중입니다.' });
      else setMsg({ type: 'error', text: `처리에 실패했습니다. (${r ?? ''})` });
    } catch { setMsg({ type: 'error', text: '네트워크 오류가 발생했습니다.' }); } finally { setBusy(false); }
  };

  if (loading) return <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)' }}>불러오는 중…</p>;
  if (!data) return <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)' }}>구독 정보를 불러오지 못했습니다.</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '14px 16px', borderRadius: 'var(--radius)', background: 'var(--bg-raised)' }}>
        <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>현재 보유 토큰</span>
        <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)' }}>{fmt(data.balance)} <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-muted)' }}>토큰</span></span>
      </div>

      {msg && (
        <p style={{ margin: 0, fontSize: 14, padding: '8px 12px', borderRadius: 'var(--radius)',
          background: msg.type === 'success' ? 'var(--success-subtle)' : 'var(--danger-subtle)',
          color: msg.type === 'success' ? 'var(--success)' : 'var(--danger)',
          border: `1px solid ${msg.type === 'success' ? 'var(--success)' : 'var(--danger)'}` }}>{msg.text}</p>
      )}

      {data.products.map((p) => {
        const periodActive = !!p.currentPeriodEnd && new Date(p.currentPeriodEnd) > new Date();
        const isActive = p.status === 'active';
        const isCanceled = p.status === 'canceled' && periodActive;
        return (
          <div key={p.code} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '16px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{p.name}</span>
              <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>월 {fmt(p.price_tokens)} 토큰</span>
            </div>

            {data.barun ? (
              <div style={{ marginTop: 12, fontSize: 14, color: 'var(--accent)', fontWeight: 600 }}>
                바른플랜에 포함되어 있어요 — 별도 구독이 필요 없습니다.
              </div>
            ) : isActive ? (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
                  구독 중 · 다음 결제 {fmtDate(p.currentPeriodEnd)} · <span style={{ color: 'var(--success)' }}>자동갱신</span>
                </span>
                <button type="button" disabled={busy} onClick={() => void act(p.code, 'cancel')}
                  style={{ alignSelf: 'flex-start', padding: '7px 14px', fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', background: 'transparent', border: '1px solid var(--border)', borderRadius: 'var(--radius)', cursor: busy ? 'default' : 'pointer' }}>
                  구독 취소
                </button>
              </div>
            ) : isCanceled ? (
              <div style={{ marginTop: 12, fontSize: 14, color: 'var(--text-secondary)' }}>
                취소됨 · <b>{fmtDate(p.currentPeriodEnd)}</b>까지 이용 가능 (이후 자동 종료)
              </div>
            ) : (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                  최초 결제일 기준 <b>매월 자동갱신</b>됩니다. 언제든 취소할 수 있으며, 취소 시 <b>이미 결제한 기간까지는 계속 이용</b>할 수 있어요.
                </p>
                <button type="button" disabled={busy} onClick={() => void act(p.code, 'subscribe')}
                  style={{ alignSelf: 'flex-start', padding: '9px 18px', fontSize: 14, fontWeight: 600, color: '#fff', background: busy ? 'var(--text-muted)' : 'var(--accent)', border: 'none', borderRadius: 'var(--radius)', cursor: busy ? 'default' : 'pointer' }}>
                  {busy ? '처리 중…' : `구독하기 (월 ${fmt(p.price_tokens)}토큰)`}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
