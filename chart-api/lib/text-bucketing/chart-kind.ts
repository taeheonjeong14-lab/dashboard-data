// Re-export from the canonical chart-app location — same type set.
export type { ChartKind } from '@/lib/chart-app/chart-kind';
export { parseChartKind } from '@/lib/chart-app/chart-kind';

export function chartTypeNoticeFor(kind: import('@/lib/chart-app/chart-kind').ChartKind): string | null {
  if (kind === 'other') {
    return '기타 차트는 병원·버전마다 양식 차이가 커서 일부 구간이 누락되거나 잘못 나뉠 수 있습니다.';
  }
  if (kind === 'efriends') {
    return '이프렌즈: PDF에 혈액검사가 많습니다. EMR 차트를 붙여 넣으면 본문·기본정보 등을 함께 읽습니다(선택).';
  }
  return null;
}
