'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { BarChart2, FileHeart, Stethoscope, ClipboardList, ClipboardCheck, Newspaper, Swords, CalendarDays } from 'lucide-react';

const navGroups = [
  {
    title: 'AI진료 보조',
    items: [
      { href: '/pre-consultation', label: '사전문진', icon: ClipboardCheck, matchPrefix: '/pre-consultation' },
      { href: '/ai-assist', label: 'Robovet AI', icon: Stethoscope, matchPrefix: '/ai-assist', badge: '준비중' },
    ],
  },
  {
    title: '병원경영',
    items: [
      { href: '/dashboard', label: '경영 대시보드', icon: BarChart2, matchPrefix: '/dashboard' },
      { href: '/competitor-analysis', label: '경쟁병원 분석', icon: Swords, matchPrefix: '/competitor-analysis' },
    ],
  },
  {
    title: '병원운영',
    items: [
      { href: '/reception', label: '초진 접수', icon: ClipboardList, matchPrefix: '/reception' },
      { href: '/health-report', label: '건강검진 리포트', icon: FileHeart, matchPrefix: '/health-report' },
    ],
  },
  {
    title: '마케팅',
    items: [
      { href: '/blog', label: '블로그 컨텐츠', icon: Newspaper, matchPrefix: '/blog' },
      { href: '/schedule', label: '디자인 요청', icon: CalendarDays, matchPrefix: '/schedule', badge: '준비중' },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside style={styles.sidebar}>
      <nav style={styles.nav}>
        {navGroups.map((group, gi) => (
          <div key={group.title || `g-${gi}`} style={styles.group}>
            {group.title && <div style={styles.groupTitle}>{group.title}</div>}
            {group.items.map((item) => {
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
                  {'badge' in item && item.badge && <span style={styles.badge}>{item.badge}</span>}
                </Link>
              );
            })}
          </div>
        ))}
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
    padding: '14px 10px 8px',
    gap: '16px',
  },
  group: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  groupTitle: {
    fontSize: '11px',
    fontWeight: 700,
    color: 'var(--text-muted)',
    letterSpacing: '0.02em',
    padding: '0 12px',
    marginBottom: '4px',
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
  badge: {
    marginLeft: 'auto',
    fontSize: 10,
    fontWeight: 600,
    padding: '1px 6px',
    borderRadius: 999,
    background: 'var(--bg-raised)',
    color: 'var(--text-muted)',
    border: '1px solid var(--border)',
    lineHeight: 1.4,
    whiteSpace: 'nowrap',
  },
};
