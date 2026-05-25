import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: '더함 병원관리 솔루션',
  description: '동물병원 통합 관리 플랫폼',
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
