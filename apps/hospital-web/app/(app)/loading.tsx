import { CenteredSpinner } from '@/components/ui/loading-spinner';

// 메뉴 클릭 즉시 표시되는 로딩 (Suspense fallback).
// 셸(사이드바/상단바)은 유지되고 본문 가운데에 스피너가 즉시 표시된다.
export default function Loading() {
  return <CenteredSpinner />;
}
