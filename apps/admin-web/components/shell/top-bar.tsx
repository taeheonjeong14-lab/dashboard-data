'use client';

import { useState } from 'react';
import Link from 'next/link';
import { LogOut } from 'lucide-react';

interface TopBarProps {
  userName: string | null;
  userEmail: string | null;
}

export function TopBar({ userName, userEmail }: TopBarProps) {
  // 이름이 있으면 이름을 노출, 없으면 이메일을 보여준다(서버에서 fallback 처리되지만 이중 안전망).
  const displayName = userName?.trim() || userEmail || null;
  const [logoOk, setLogoOk] = useState(true);

  return (
    <header
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 'var(--topbar-height)',
        background: 'var(--bg)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        zIndex: 60,
      }}
    >
      <Link
        href="/admin/performance"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          textDecoration: 'none',
          fontSize: 16,
          fontWeight: 800,
          letterSpacing: '-0.01em',
          color: 'var(--text)',
        }}
      >
        {logoOk ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src="/logo.png"
            alt="Vet Solution"
            style={{ height: 48, width: 'auto', display: 'block' }}
            onError={() => setLogoOk(false)}
          />
        ) : (
          <>Vet Solution</>
        )}
      </Link>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {displayName ? (
          <span
            style={{
              fontSize: 13,
              color: 'var(--text-secondary)',
              maxWidth: 280,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{ fontWeight: 600, color: 'var(--text)' }}>{displayName}</span>
          </span>
        ) : null}

        <a
          href="/auth/signout"
          title="로그아웃"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 10px',
            fontSize: 12,
            color: 'var(--text-secondary)',
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            textDecoration: 'none',
            cursor: 'pointer',
          }}
        >
          <LogOut size={14} />
          <span>로그아웃</span>
        </a>
      </div>
    </header>
  );
}
