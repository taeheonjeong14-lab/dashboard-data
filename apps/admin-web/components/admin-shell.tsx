'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { ChartExtractionBanner, ChartExtractionProvider } from '@/components/chart-extraction-provider';
import { TopBar } from '@/components/shell/top-bar';
import { Sidebar } from '@/components/shell/sidebar';

interface AdminShellProps {
  children: ReactNode;
  userName?: string | null;
  userEmail?: string | null;
  title?: string;
  description?: string;
}

export function AdminShell({
  children,
  userName = null,
  userEmail = null,
  title,
  description,
}: AdminShellProps) {
  void title;
  void description;

  // 홈은 허브 화면 — 사이드바를 숨기고 본문을 전체 폭으로(좌측 여백 제거).
  const pathname = usePathname();
  const isHome = pathname === '/admin/home';

  return (
    <ChartExtractionProvider>
      <div style={{ display: 'flex', minHeight: '100vh' }}>
        <TopBar userName={userName} userEmail={userEmail} />
        {!isHome && <Sidebar />}
        <div
          style={{
            marginLeft: isHome ? 0 : 'var(--sidebar-width)',
            marginTop: 'var(--topbar-height)',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
          }}
        >
          <ChartExtractionBanner />
          <main
            style={{
              flex: 1,
              padding: 'var(--admin-content-pad)',
              background: 'var(--bg-subtle)',
              minHeight: 'calc(100vh - var(--topbar-height))',
            }}
          >
            {children}
          </main>
        </div>
      </div>
    </ChartExtractionProvider>
  );
}
