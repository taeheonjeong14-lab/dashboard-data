import type { ExamType, RadiologySub } from '@/lib/chart-app/image-case-types';

/**
 * 건강검진 케이스 이미지 배치 입력 타입.
 * 배치는 이제 라벨 기반 코드 라우팅(health-report-image-placement-run.ts)과
 * 비전(c/d 검사소견·a/b 넘침 선택)으로 처리한다. (구 LLM 배치 generateImagePlacement 제거됨)
 */
export type PlacementImageInput = {
  id: string;
  examType: ExamType;
  radiologySub: RadiologySub | null;
  bodyPart: string;
  storagePath: string;
};
