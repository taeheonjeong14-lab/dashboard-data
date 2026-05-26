'use client';

import type { ReactNode } from 'react';
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

  return (
    <ChartExtractionProvider>
      <div style={{ display: 'flex', minHeight: '100vh' }}>
        <TopBar userName={userName} userEmail={userEmail} />
        <Sidebar />
        <div
          style={{
            marginLeft: 'var(--sidebar-width)',
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
              padding: '28px',
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
