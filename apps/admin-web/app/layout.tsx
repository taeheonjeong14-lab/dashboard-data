import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: '더함 관리자',
  description: '관리자용 통합 UI — Supabase 로그인 · dashboard-api 연동 스모크',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard-dynamic-subset.css"
          precedence="default"
        />
        {children}
      </body>
    </html>
  );
}
