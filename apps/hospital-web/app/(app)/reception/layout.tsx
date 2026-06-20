import type { ReactNode } from 'react';
import { hasFeature } from '@/lib/feature-access';
import { SubscriptionGate } from '@/components/shell/subscription-gate';

// 초진 접수 = 운영 패키지 구독(또는 바른플랜) 필요.
export default async function Layout({ children }: { children: ReactNode }) {
  if (!(await hasFeature('reception'))) {
    return <SubscriptionGate feature="초진 접수" />;
  }
  return <>{children}</>;
}
