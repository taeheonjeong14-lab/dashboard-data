import { Suspense } from 'react';
import AdminBlogToolsConsole from '@/components/admin-blog-tools-console';

export default function AdminBlogToolsPage() {
  return (
    <Suspense fallback={null}>
      <AdminBlogToolsConsole />
    </Suspense>
  );
}
