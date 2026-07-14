'use client';

import { useState } from 'react';
import Link from 'next/link';
import { LogOut, Home, Settings } from 'lucide-react';
import { NotificationBell } from './notification-bell';
import { SettingsModal } from './settings-modal';

interface TopBarProps {
  userName: string | null;
  userEmail: string | null;
}

export function TopBar({ userName, userEmail }: TopBarProps) {
  // 이름이 있으면 이름을 노출, 없으면 이메일을 보여준다(서버에서 fallback 처리되지만 이중 안전망).
  const displayName = userName?.trim() || userEmail || null;
  const [logoOk, setLogoOk] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <>
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
        href="/admin/home"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          textDecoration: 'none',
          fontSize: 20,
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
            style={{ height: 36, width: 'auto', display: 'block' }}
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
              fontSize: 14,
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

        <Link
          href="/admin/home"
          title="홈"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 30,
            height: 30,
            borderRadius: 'var(--radius)',
            color: 'var(--text-muted)',
            background: 'transparent',
          }}
        >
          <Home size={16} />
        </Link>

        <NotificationBell />

        <button
          onClick={() => setSettingsOpen(true)}
          title="설정"
          className="adminBtnFree" /* 30x30 아이콘 버튼 — 공통 버튼 높이 규칙 제외 */
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 30,
            height: 30,
            borderRadius: 'var(--radius)',
            color: 'var(--text-muted)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          <Settings size={16} />
        </button>

        <a
          href="/auth/signout"
          title="로그아웃"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 10px',
            fontSize: 14,
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
    <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}
