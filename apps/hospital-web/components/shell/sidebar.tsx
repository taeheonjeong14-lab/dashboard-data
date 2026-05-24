'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { BarChart2, FileHeart, Stethoscope, FileSpreadsheet, ClipboardList } from 'lucide-react';

const navItems = [
  {
    href: '/dashboard',
    label: '경영 대시보드',
    icon: BarChart2,
    matchPrefix: '/dashboard',
  },
  {
    href: '/reception',
    label: '초진 접수',
    icon: ClipboardList,
    matchPrefix: '/reception',
  },
  {
    href: '/health-report',
    label: '건강검진 리포트',
    icon: FileHeart,
    matchPrefix: '/health-report',
  },
  {
    href: '/stats-upload',
    label: '경영통계 제출',
    icon: FileSpreadsheet,
    matchPrefix: '/stats-upload',
  },
  {
    href: '/ai-assist',
    label: 'AI 진료 보조',
    icon: Stethoscope,
    matchPrefix: '/ai-assist',
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside style={styles.sidebar}>
      <nav style={styles.nav}>
        {navItems.map((item) => {
          const isActive = pathname.startsWith(item.matchPrefix);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                ...styles.navItem,
                ...(isActive ? styles.navItemActive : {}),
              }}
            >
              <Icon
                size={15}
                style={{
                  ...styles.navIcon,
                  color: isActive ? 'var(--accent)' : 'var(--text-muted)',
                }}
              />
              <span style={{ color: isActive ? 'var(--accent)' : 'var(--text-secondary)' }}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

const styles: Record<string, React.CSSProperties> = {
  sidebar: {
    position: 'fixed',
    top: 'var(--topbar-height)',
    left: 0,
    bottom: 0,
    width: 'var(--sidebar-width)',
    background: 'var(--bg)',
    borderRight: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    zIndex: 50,
    overflowY: 'auto',
  },
  nav: {
    display: 'flex',
    flexDirection: 'column',
    padding: '14px 10px 4px',
    gap: '2px',
  },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 12px',
    borderRadius: 'var(--radius)',
    fontSize: '13.5px',
    fontWeight: 500,
    textDecoration: 'none',
    color: 'var(--text-secondary)',
    transition: 'background 0.15s',
  },
  navItemActive: {
    background: 'var(--accent-subtle)',
    fontWeight: 600,
  },
  navIcon: {
    flexShrink: 0,
  },
};
