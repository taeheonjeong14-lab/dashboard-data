'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Settings, LogOut, Coins } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { SettingsModal } from './settings-modal';

interface TopBarProps {
  userName: string | null;
  hospitalName: string | null;
  tokenBalance?: number;
}

export function TopBar({ userName, hospitalName, tokenBalance }: TopBarProps) {
  const router = useRouter();
  const [logoOk, setLogoOk] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 데모용 마스킹: 다른 병원에 데모할 때 상단바의 사용자 이름·병원명만 흐리게 가린다.
  // 1순위) 환경변수 NEXT_PUBLIC_DEMO_MASK=1 이면 서버 렌더부터 "항상" 마스킹(로그아웃/리다이렉트/새로고침 무관).
  // 2순위) URL ?demo=1 로 켜고 ?demo=0 로 끔(localStorage 기억). env 가 켜져 있으면 토글은 무시.
  const envMask = process.env.NEXT_PUBLIC_DEMO_MASK === '1';
  const [mask, setMask] = useState<boolean>(() => {
    if (envMask) return true;
    if (typeof window === 'undefined') return false;
    try { return localStorage.getItem('demoMask') === '1'; } catch { return false; }
  });
  useEffect(() => {
    if (envMask) return; // env 강제 시 토글 무시
    try {
      const q = new URLSearchParams(window.location.search).get('demo');
      if (q === '1') { localStorage.setItem('demoMask', '1'); setMask(true); }
      else if (q === '0') { localStorage.removeItem('demoMask'); setMask(false); }
    } catch { /* noop */ }
  }, [envMask]);

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  };

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
      {/* Left — logo (public/logo.svg 있으면 이미지, 없으면 텍스트 워드마크) */}
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
        {logoOk ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src="/logo.png"
            alt="THEHAMM"
            style={{ height: 24, width: 'auto', display: 'block' }}
            onError={() => setLogoOk(false)}
          />
        ) : (
          <>THEHAMM</>
        )}
      </Link>

      {/* Right — token balance + user info + settings + logout */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          title="보유 토큰"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            padding: '5px 10px',
            borderRadius: 'var(--radius)',
            background: 'var(--accent-subtle)',
            color: 'var(--accent)',
            fontSize: 13,
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
        >
          <Coins size={14} />
          {Math.round(tokenBalance ?? 0).toLocaleString()} 토큰
        </span>
        <span
          title={mask ? '데모 마스킹 중 (URL 에 ?demo=0 으로 해제)' : undefined}
          style={{
            fontSize: 13,
            color: 'var(--text-secondary)',
            maxWidth: 280,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            filter: mask ? 'blur(6px)' : undefined,
            userSelect: mask ? 'none' : undefined,
          }}
        >
          <span style={{ fontWeight: 600, color: 'var(--text)' }}>{userName ?? '사용자'}</span>
          {hospitalName && <span style={{ color: 'var(--text-muted)' }}> ({hospitalName})</span>}
        </span>

        <button
          onClick={() => setSettingsOpen(true)}
          title="설정"
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
    <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} tokenBalance={tokenBalance} />
    </>
  );
}
