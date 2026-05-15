'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  BarChart2,
  FileText,
  Upload,
  HeartPulse,
  Users,
  Building2,
  LogOut,
  Stethoscope,
  FileSpreadsheet,
  RefreshCw,
} from 'lucide-react';
import { ChartExtractionBanner, ChartExtractionProvider } from '@/components/chart-extraction-provider';
import styles from './admin-shell.module.css';

type NavItem = {
  href: string;
  label: string;
  icon: ReactNode;
  // section이 있으면 ?section= 쿼리까지 비교, 없으면 pathname.startsWith만 사용
  section?: string | null;
};

const BUSINESS_NAV: NavItem[] = [
  { href: '/admin/performance', label: '대시보드', icon: <BarChart2 size={17} /> },
  { href: '/admin/data-upload?section=stats', label: '경영통계 수집', icon: <FileSpreadsheet size={17} />, section: 'stats' },
  { href: '/admin/data-upload?section=collect', label: '마케팅데이터 수집', icon: <RefreshCw size={17} />, section: 'collect' },
];

const CHART_NAV: NavItem[] = [
  { href: '/admin/chart-data', label: '차트 목록', icon: <FileText size={17} /> },
  { href: '/admin/health-report', label: '건강검진 리포트', icon: <HeartPulse size={17} /> },
  { href: '/admin/data-upload', label: '차트 데이터 수집', icon: <Upload size={17} />, section: null },
];

const MANAGE_NAV: NavItem[] = [
  { href: '/admin/users/users', label: '사용자 관리', icon: <Users size={17} /> },
  { href: '/admin/users/hospitals', label: '병원 관리', icon: <Building2 size={17} /> },
];

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      className={`${styles.navLink} ${active ? styles.navLinkActive : ''}`}
    >
      {item.icon}
      <span>{item.label}</span>
    </Link>
  );
}

export function AdminShell({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentSection = searchParams.get('section');
  void title;
  void description;

  function isActive(item: NavItem): boolean {
    const basePath = item.href.split('?')[0];
    if (!pathname.startsWith(basePath)) return false;
    if ('section' in item) {
      return currentSection === (item.section ?? null);
    }
    return true;
  }

  return (
    <ChartExtractionProvider>
      <div className={styles.root}>
        <aside className={styles.sidebar}>
          {/* Brand */}
          <div className={styles.brand}>
            <div className={styles.brandIcon}>
              <Stethoscope size={16} />
            </div>
            <div className={styles.brandText}>
              <span className={styles.brandName}>Vet Solution</span>
              <span className={styles.brandSub}>관리자 콘솔</span>
            </div>
          </div>

          {/* Nav */}
          <nav className={styles.nav}>
            <div className={styles.navSection}>
              <div className={styles.navSectionLabel}>경영분석</div>
              {BUSINESS_NAV.map((item) => (
                <NavLink key={item.href} item={item} active={isActive(item)} />
              ))}
            </div>

            <div className={styles.navDivider} />

            <div className={styles.navSection}>
              <div className={styles.navSectionLabel}>차트 데이터</div>
              {CHART_NAV.map((item) => (
                <NavLink key={item.href} item={item} active={isActive(item)} />
              ))}
            </div>

            <div className={styles.navDivider} />

            <div className={styles.navSection}>
              <div className={styles.navSectionLabel}>관리</div>
              {MANAGE_NAV.map((item) => (
                <NavLink key={item.href} item={item} active={isActive(item)} />
              ))}
            </div>
          </nav>

          {/* Logout */}
          <a href="/auth/signout" title="로그아웃" className={styles.logoutBtn}>
            <LogOut size={16} />
            <span>로그아웃</span>
          </a>
        </aside>

        <main className={styles.main}>
          <ChartExtractionBanner />
          {children}
        </main>
      </div>
    </ChartExtractionProvider>
  );
}
