import type { ExamType, RadiologySub } from '@/lib/chart-app/image-case-types';
import { EXAM_TYPE_LABEL_KO, RADIOLOGY_SUB_LABEL_KO } from '@/lib/chart-app/image-case-types';

export type SimpleCaptionInput = {
  examType: ExamType;
  radiologySub: RadiologySub | null;
  bodyPart: string;
};

/**
 * 간소 캡션: 검사종류 + 부위만 (소견·해석 없음).
 * 예) "치아 방사선", "흉부 방사선", "복부 초음파", "구강", "우안".
 *
 * 장비명은 **시각적으로 확실할 때만** 쓴다. 방사선·초음파·현미경은 사진만 봐도 구분되지만,
 * 슬릿램프(세극등)는 특수 안과 장비인데 일반 카메라로 찍은 눈 사진과 구분이 어려워 라벨이 자주
 * 틀린다 — 그냥 눈 사진에 "우안 슬릿램프"가 붙는 일이 잦았다. 보호자가 읽는 리포트에서 장비명은
 * 정보 가치도 낮으므로, 확실하지 않은 장비는 이름을 빼고 부위만 남긴다("우안").
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
  // 슬릿램프: 장비명을 단정하지 않고 부위만. 부위도 없으면 최소한 '눈'.
  if (input.examType === 'slit_lamp') {
    return part || '눈';
  }
  return part ? `${part} ${examKo}` : examKo;
}
