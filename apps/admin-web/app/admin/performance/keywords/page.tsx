import { Suspense } from 'react';
import AdminKeywordBoard from '@/components/admin-keyword-board';

export const dynamic = 'force-dynamic';

export default function AdminKeywordBoardPage() {
  return (
    <div className="adminMainSingleGutter">
      <Suspense fallback={null}>
        <AdminKeywordBoard />
      </Suspense>
    </div>
  );
}
