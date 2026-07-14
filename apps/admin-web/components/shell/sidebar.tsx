'use client';

import type { ComponentType, ReactElement } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  BarChart2,
  FileText,
  HeartPulse,
  Users,
  Building2,
  RefreshCw,
  ClipboardList,
  ClipboardCheck,
  Newspaper,
  ShieldCheck,
  Gauge,
  ListTodo,
  Activity,
  Search,
  Sparkles,
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
        href: '/admin/data-upload',
        label: '데이터 수집',
        icon: RefreshCw,
        matchPrefix: '/admin/data-upload',
      },
      { href: '/admin/naver-keyword', label: '네이버 검색량', icon: Search, matchPrefix: '/admin/naver-keyword' },
    ],
  },
  {
    title: '차트 데이터',
    items: [
      { href: '/admin/work-board', label: '작업 현황', icon: ListTodo, matchPrefix: '/admin/work-board' },
      { href: '/admin/chart-data', label: '차트 목록', icon: FileText, matchPrefix: '/admin/chart-data' },
      { href: '/admin/health-report', label: '건강검진 리포트', icon: HeartPulse, matchPrefix: '/admin/health-report' },
      { href: '/admin/case-blog', label: '진료케이스', icon: Newspaper, matchPrefix: '/admin/case-blog' },
      { href: '/admin/blog-review', label: '글 검수', icon: ShieldCheck, matchPrefix: '/admin/blog-review' },
      { href: '/admin/prompt-improve', label: '프롬프트 개선', icon: Sparkles, matchPrefix: '/admin/prompt-improve' },
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
      // 병원 심사·병원 정보·토큰을 하나로 합친 콘솔(/admin/hospitals).
      { href: '/admin/hospitals', label: '병원 관리', icon: Building2, matchPrefix: '/admin/hospitals' },
      { href: '/admin/users/users', label: '사용자 관리', icon: Users, matchPrefix: '/admin/users/users' },
      { href: '/admin/feature-usage', label: '사용 현황', icon: Activity, matchPrefix: '/admin/feature-usage' },
      { href: '/admin/error-logs', label: '에러 로그', icon: AlertTriangle, matchPrefix: '/admin/error-logs' },
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
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.title || `g-${gi}`} style={styles.group}>
            {group.title && <div style={styles.groupTitle}>{group.title}</div>}
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
    fontSize: '14px',
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
