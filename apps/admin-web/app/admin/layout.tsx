import { Suspense, type ReactNode } from 'react';
import { requireAdminSession } from '@/lib/require-admin';
import { AdminShell } from '@/components/admin-shell';
import './admin-legacy.css';

export const dynamic = 'force-dynamic';

export default async function AdminSectionLayout({ children }: { children: ReactNode }) {
  await requireAdminSession();
  return (
    <Suspense>
      <AdminShell>{children}</AdminShell>
    </Suspense>
  );
}
