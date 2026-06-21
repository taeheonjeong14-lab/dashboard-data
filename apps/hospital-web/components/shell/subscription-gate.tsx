import { Lock } from 'lucide-react';

// 구독이 필요한 기능에 접근권이 없을 때 표시. (서버 컴포넌트)
export function SubscriptionGate({ feature }: { feature: string }) {
  return (
    <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ maxWidth: 440, width: '100%', textAlign: 'center', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '40px 32px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <span style={{ display: 'inline-flex', width: 48, height: 48, borderRadius: 14, background: 'var(--accent-subtle)', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
          <Lock size={22} style={{ color: 'var(--accent)' }} />
        </span>
        <h1 style={{ margin: '0 0 10px', fontSize: 18, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.02em' }}>
          운영 패키지 구독이 필요해요
        </h1>
        <p style={{ margin: '0 0 18px', fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          <b>{feature}</b>은(는) 운영 패키지 구독에 포함된 기능이에요.<br />
          우측 상단 <b>설정 → 이용권 구매</b>에서 구독하면 바로 이용할 수 있습니다.
        </p>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
          (바른플랜 병원은 별도 구독 없이 포함되어 있어요)
        </p>
      </div>
    </div>
  );
}
