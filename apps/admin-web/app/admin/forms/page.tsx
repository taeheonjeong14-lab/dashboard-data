import { Suspense } from 'react';
import AdminFormsConsole from '@/components/admin-forms-console';

export default function AdminFormsPage() {
  return (
    <Suspense fallback={null}>
      <AdminFormsConsole />
    </Suspense>
  );
}
