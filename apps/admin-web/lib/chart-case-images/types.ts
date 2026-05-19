export const EXAM_TYPES = [
  'radiology',
  'ultrasound',
  'microscopy',
  'endoscopy',
  'slit_lamp',
  'other',
] as const;

export type ExamType = (typeof EXAM_TYPES)[number];

export const RADIOLOGY_SUBS = ['thorax', 'abdomen', 'joint', 'dental'] as const;

export type RadiologySub = (typeof RADIOLOGY_SUBS)[number];

export type FindingSpot = { cx: number; cy: number; r: number };

export type CaseImageItem = {
  index: number;
  fileName: string;
  examType: ExamType;
  radiologySub: RadiologySub | null;
  hasNotableFinding: boolean;
  isClearFinding: boolean;
  briefComment: string;
  findingSpots?: FindingSpot[];
  relatedAssessmentCondition: string | null;
};

export type CaseImageAnalysis = {
  images: CaseImageItem[];
};

export const EXAM_TYPE_LABEL_KO: Record<ExamType, string> = {
  radiology: '방사선',
  ultrasound: '초음파',
  microscopy: '현미경',
  endoscopy: '검이경',
  slit_lamp: '슬릿램프',
  other: '그 외',
};

export const RADIOLOGY_SUB_LABEL_KO: Record<RadiologySub, string> = {
  thorax: '흉부',
  abdomen: '복부',
  joint: '관절',
  dental: '치아',
};
