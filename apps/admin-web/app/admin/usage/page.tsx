'use client';

import { useState } from 'react';
import AdminUsageDashboard from '@/components/admin-usage-dashboard';
import { AdminTokenOrders } from '@/components/admin-token-orders';

export default function AdminUsagePage() {
  const [tab, setTab] = useState<'orders' | 'usage'>('orders');
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, padding: '10px 14px 0', borderBottom: '1px solid var(--border)' }}>
        {([['orders', '토큰 구매'], ['usage', '사용 내역']] as const).map(([k, lbl]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            style={{
              padding: '8px 14px', fontSize: 13.5, fontWeight: tab === k ? 700 : 500,
              color: tab === k ? 'var(--accent)' : 'var(--text-muted)',
              background: 'transparent', border: 'none',
              borderBottom: `2px solid ${tab === k ? 'var(--accent)' : 'transparent'}`,
              marginBottom: -1, cursor: 'pointer',
            }}
          >
            {lbl}
          </button>
        ))}
      </div>
      {tab === 'orders' ? (
        <div style={{ padding: '20px 14px' }}><AdminTokenOrders /></div>
      ) : (
        <AdminUsageDashboard />
      )}
    </div>
  );
}
