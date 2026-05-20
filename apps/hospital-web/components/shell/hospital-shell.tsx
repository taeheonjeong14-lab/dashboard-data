'use client';

import type { ReactNode } from 'react';
import { Sidebar } from './sidebar';
import { TopBar } from './top-bar';

interface HospitalShellProps {
  children: ReactNode;
  userName: string | null;
  hospitalName: string | null;
}

export function HospitalShell({ children, userName, hospitalName }: HospitalShellProps) {
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <TopBar userName={userName} hospitalName={hospitalName} />
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
  );
}
