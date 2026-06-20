import type { ReactNode } from 'react';
import { hasFeature } from '@/lib/feature-access';
import { SubscriptionGate } from '@/components/shell/subscription-gate';

// 사전문진 = 운영 패키지 구독(또는 바른플랜) 필요.
export default async function Layout({ children }: { children: ReactNode }) {
  if (!(await hasFeature('survey'))) {
    return <SubscriptionGate feature="사전문진" />;
  }
  return <>{children}</>;
}
