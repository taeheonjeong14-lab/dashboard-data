'use client';

import type { ReactNode } from 'react';
import { Sidebar } from './sidebar';
import { TopBar } from './top-bar';
import { HospitalProvider } from './hospital-context';

interface HospitalShellProps {
  children: ReactNode;
  userName: string | null;
  hospitalName: string | null;
  tokenBalance?: number;
  userId?: string | null;
  hospitalId?: string | null;
  isStaff?: boolean;
}

export function HospitalShell({ children, userName, hospitalName, tokenBalance, userId = null, hospitalId = null, isStaff = false }: HospitalShellProps) {
  return (
    <HospitalProvider userId={userId} hospitalId={hospitalId} isStaff={isStaff}>
      <div style={{ display: 'flex', minHeight: '100vh' }}>
        <TopBar userName={userName} hospitalName={hospitalName} tokenBalance={tokenBalance} />
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
    </HospitalProvider>
  );
}
