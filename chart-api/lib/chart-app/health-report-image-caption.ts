import type { ExamType, RadiologySub } from '@/lib/chart-app/image-case-types';
import { EXAM_TYPE_LABEL_KO, RADIOLOGY_SUB_LABEL_KO } from '@/lib/chart-app/image-case-types';

export type SimpleCaptionInput = {
  examType: ExamType;
  radiologySub: RadiologySub | null;
  bodyPart: string;
};

/**
 * 간소 캡션: 검사종류 + 부위만 (소견·해석 없음).
 * 예) "치아 방사선", "흉부 방사선", "복부 초음파", "구강".
 */
export function simpleHealthReportImageCaption(input: SimpleCaptionInput): string {
  const examKo = EXAM_TYPE_LABEL_KO[input.examType] ?? input.examType;
  const part = (input.bodyPart ?? '').trim();

  if (input.examType === 'radiology' && input.radiologySub) {
    const subKo = RADIOLOGY_SUB_LABEL_KO[input.radiologySub] ?? input.radiologySub;
    return `${subKo} ${examKo}`;
  }
  if (input.examType === 'other') {
    return part || '사진';
  }
  return part ? `${part} ${examKo}` : examKo;
}
