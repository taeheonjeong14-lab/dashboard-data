'use client';

import type { ReactNode } from 'react';
import { Sidebar } from './sidebar';

interface HospitalShellProps {
  children: ReactNode;
  userName: string | null;
  hospitalName: string | null;
}

export function HospitalShell({ children, userName, hospitalName }: HospitalShellProps) {
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar userName={userName} hospitalName={hospitalName} />
      <div
        style={{
          marginLeft: 'var(--sidebar-width)',
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
            minHeight: '100vh',
          }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
