import type { ReactNode } from 'react';
import { hasFeature } from '@/lib/feature-access';
import { SubscriptionGate } from '@/components/shell/subscription-gate';
import { DashboardChrome } from './dashboard-chrome';

// 경영 대시보드 = 운영 패키지 구독(또는 바른플랜) 필요. 서버에서 접근권 확인 후 게이팅.
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  if (!(await hasFeature('dashboard'))) {
    return <SubscriptionGate feature="경영 대시보드" />;
  }
  return <DashboardChrome>{children}</DashboardChrome>;
}
