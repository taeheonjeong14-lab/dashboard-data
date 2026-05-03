import type { ReactNode } from 'react';

export const metadata = {
  title: 'dashboard-api',
  description: 'BFF for dashboard-ui (dashboard-data)',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body style={{ fontFamily: 'system-ui', padding: 24 }}>{children}</body>
    </html>
  );
}
