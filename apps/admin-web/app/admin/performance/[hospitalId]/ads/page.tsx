import { redirect } from 'next/navigation';

// 광고 통계는 hospital 대시보드와 같이 파워링크/플레이스/인스타/구글 탭으로 나뉘었다.
export default async function AdminPerformanceAdsRedirect({
  params,
}: {
  params: Promise<{ hospitalId: string }>;
}) {
  const { hospitalId } = await params;
  redirect(`/admin/performance/${hospitalId}/powerlink-ads`);
}
