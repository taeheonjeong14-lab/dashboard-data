import { redirect } from 'next/navigation';

// 경영 통계는 hospital 대시보드와 같이 매출/진료건수/신규환자 탭으로 나뉘었다.
export default async function AdminPerformanceManagementRedirect({
  params,
}: {
  params: Promise<{ hospitalId: string }>;
}) {
  const { hospitalId } = await params;
  redirect(`/admin/performance/${hospitalId}/sales`);
}
