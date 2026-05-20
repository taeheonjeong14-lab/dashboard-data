import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'VetSolution',
  description: '동물병원 통합 관리 플랫폼',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" className="dark">
      <body>{children}</body>
    </html>
  );
}
