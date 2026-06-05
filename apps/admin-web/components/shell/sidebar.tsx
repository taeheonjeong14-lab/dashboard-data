'use client';

import type { ComponentType, ReactElement } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  BarChart2,
  FileText,
  HeartPulse,
  Users,
  Building2,
  FileSpreadsheet,
  RefreshCw,
  ClipboardList,
  ClipboardCheck,
  type LucideProps,
} from 'lucide-react';

type IconType = ComponentType<LucideProps>;

type NavItem = {
  href: string;
  label: string;
  icon: IconType;
  /** ?section= 쿼리도 함께 비교해야 하는 경우 — 없으면 pathname.startsWith 만 사용 */
  section?: string | null;
  matchPrefix?: string;
};

type NavGroup = {
  title: string;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    title: '경영분석',
    items: [
      { href: '/admin/performance', label: '대시보드', icon: BarChart2, matchPrefix: '/admin/performance' },
      {
        href: '/admin/data-upload?section=stats',
        label: '경영통계 수집',
        icon: FileSpreadsheet,
        matchPrefix: '/admin/data-upload',
        section: 'stats',
      },
      {
        href: '/admin/data-upload?section=collect',
        label: '데이터 수집',
        icon: RefreshCw,
        matchPrefix: '/admin/data-upload',
        section: 'collect',
      },
    ],
  },
  {
    title: '차트 데이터',
    items: [
      { href: '/admin/chart-data', label: '차트 목록', icon: FileText, matchPrefix: '/admin/chart-data' },
      { href: '/admin/health-report', label: '건강검진 리포트', icon: HeartPulse, matchPrefix: '/admin/health-report' },
    ],
  },
  {
    title: '문진·접수',
    items: [
      { href: '/admin/pre-consultation', label: '사전문진', icon: ClipboardList, matchPrefix: '/admin/pre-consultation' },
      { href: '/admin/intake', label: '초진 접수', icon: ClipboardCheck, matchPrefix: '/admin/intake' },
    ],
  },
  {
    title: '관리',
    items: [
      { href: '/admin/users/users', label: '사용자 관리', icon: Users, matchPrefix: '/admin/users/users' },
      { href: '/admin/users/hospitals', label: '병원 관리', icon: Building2, matchPrefix: '/admin/users/hospitals' },
    ],
  },
];

export function Sidebar(): ReactElement {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentSection = searchParams.get('section');

  function isActive(item: NavItem): boolean {
    const prefix = item.matchPrefix ?? item.href.split('?')[0];
    if (!pathname.startsWith(prefix)) return false;
    if ('section' in item) return currentSection === (item.section ?? null);
    return true;
  }

  return (
    <aside style={styles.sidebar}>
      <nav style={styles.nav}>
        {NAV_GROUPS.map((group) => (
          <div key={group.title} style={styles.group}>
            <div style={styles.groupTitle}>{group.title}</div>
            {group.items.map((item) => {
              const active = isActive(item);
              const Icon = item.icon;
              return (
                <Link
                  key={`${item.href}-${item.section ?? ''}`}
                  href={item.href}
                  style={{
                    ...styles.navItem,
                    ...(active ? styles.navItemActive : {}),
                  }}
                >
                  <Icon
                    size={15}
                    style={{
                      ...styles.navIcon,
                      color: active ? 'var(--accent)' : 'var(--text-muted)',
                    }}
                  />
                  <span style={{ color: active ? 'var(--accent)' : 'var(--text-secondary)' }}>
                    {item.label}
                  </span>
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
};
