'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Settings, LogOut } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

interface TopBarProps {
  userName: string | null;
  hospitalName: string | null;
}

export function TopBar({ userName, hospitalName }: TopBarProps) {
  const pathname = usePathname();
  const router = useRouter();

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  };

  const settingsActive = pathname.startsWith('/settings');

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
      {/* Left — logo */}
      <Link
        href="/dashboard"
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
        <span style={{ color: 'var(--accent)' }}>Vet</span>Solution
      </Link>

      {/* Right — user info + settings + logout */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
          <span style={{ fontWeight: 600, color: 'var(--text)' }}>{userName ?? '사용자'}</span>
          {hospitalName && <span style={{ color: 'var(--text-muted)' }}> ({hospitalName})</span>}
        </span>

        <Link
          href="/settings"
          title="설정"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 30,
            height: 30,
            borderRadius: 'var(--radius)',
            color: settingsActive ? 'var(--accent)' : 'var(--text-muted)',
            background: settingsActive ? 'var(--accent-subtle)' : 'transparent',
            textDecoration: 'none',
          }}
        >
          <Settings size={16} />
        </Link>

        <button
          onClick={handleSignOut}
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
            cursor: 'pointer',
          }}
        >
          <LogOut size={14} />
          <span>로그아웃</span>
        </button>
      </div>
    </header>
  );
}
