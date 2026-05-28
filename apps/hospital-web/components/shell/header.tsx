'use client';

import { usePathname } from 'next/navigation';

const pageTitles: Record<string, string> = {
  '/dashboard': '경영 대시보드',
  '/dashboard/sales': '매출',
  '/dashboard/patients': '신규환자',
  '/dashboard/blog': '블로그',
  '/dashboard/place': '플레이스',
  '/dashboard/powerlink-ads': '파워링크광고',
  '/dashboard/place-ads': '플레이스광고',
  '/dashboard/ads': '파워링크광고',
  '/dashboard/instagram-ads': '인스타광고',
  '/dashboard/google-ads': '구글광고',
  '/health-report': '건강검진 리포트',
  '/ai-assist': 'AI 진료 보조',
};

function getPageTitle(pathname: string): string {
  // Try exact match first
  if (pageTitles[pathname]) return pageTitles[pathname];
  // Try prefix match (longest first)
  const sorted = Object.keys(pageTitles).sort((a, b) => b.length - a.length);
  for (const key of sorted) {
    if (pathname.startsWith(key)) return pageTitles[key];
  }
  return 'VetSolution';
}

export function Header() {
  const pathname = usePathname();
  const title = getPageTitle(pathname);

  return (
    <header
      style={{
        position: 'fixed',
        top: 0,
        left: 'var(--sidebar-width)',
        right: 0,
        height: '40px',
        background: 'var(--bg)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
        padding: '0 16px',
        zIndex: 40,
      }}
    >
      <span
        style={{
          fontSize: '13px',
          fontWeight: 500,
          color: 'var(--text)',
        }}
      >
        {title}
      </span>
    </header>
  );
}
