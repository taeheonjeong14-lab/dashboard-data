import { Suspense } from 'react';
import AdminDataUpload from '@/components/admin-data-upload';

// 데이터 수집 허브: 경영통계 수집 / 데이터 자동 수집 / 자동 수집 스케줄 / 수집 내역 탭.
// 탭 전환·좌측 패널 구성은 클라이언트 컴포넌트(AdminDataUpload)가 담당한다.
export default function AdminDataUploadPage() {
  return (
    <Suspense fallback={<p style={{ padding: 16, color: '#64748b', fontSize: 13 }}>불러오는 중…</p>}>
      <AdminDataUpload />
    </Suspense>
  );
}
