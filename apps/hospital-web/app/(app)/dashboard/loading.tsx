import { CenteredSpinner } from '@/components/ui/loading-spinner';

// 대시보드 탭 전환 시 본문 가운데에 표시되는 로딩 (탭 내비는 유지됨).
export default function DashboardLoading() {
  return <CenteredSpinner minHeight="60vh" />;
}
