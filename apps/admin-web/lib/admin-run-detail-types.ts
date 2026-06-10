import type { ChartKind } from '@/lib/chart-extraction/chart-kind';

export type RunDetailChartKind = ChartKind;

export type PlanRow = {
  id: string;
  code: string | null;
  treatmentPrescription: string | null;
  qty: string | null;
  unit: string | null;
  day: string | null;
  total: string | null;
  route: string | null;
  signId: string | null;
  rawText: string | null;
};

export type RunDetailResponse = {
  run: {
    id: string;
    createdAt: string;
    friendlyId: string | null;
    fileName: string | null;
    chartType: RunDetailChartKind;
    /** hospital-ui 건강검진 리포트 제출(hospital_notes 존재) */
    isHealthCheckup: boolean;
    /** hospital-ui 블로그 컨텐츠 제출(blog_case 존재) */
    isBlog: boolean;
  };
  basicInfo: {
    id: string;
    hospitalName: string | null;
    ownerName: string | null;
    patientName: string | null;
    species: string | null;
    breed: string | null;
    birth: string | null;
    age: number | null;
    sex: string | null;
  } | null;
  chartTypeNotice: string | null;
  /** 병원이 업로드한 원본 PDF(서명 URL). 이미지는 이미지 분석 탭에서 본다. */
  sourceFiles: {
    pdfs: Array<{ name: string; url: string }>;
  };
  chartBodyByDate: Array<{
    id: string;
    dateTime: string;
    bodyText: string;
    planText: string;
    lineCount: number;
    planDetected: boolean;
    planRowsFromText: PlanRow[];
  }>;
  labItemsByDate: Array<{
    dateTime: string;
    pages?: number[];
    items: Array<{
      id: string;
      itemName: string;
      itemRawName: string;
      valueText: string;
      unit: string | null;
      referenceRange: string | null;
      flag: 'low' | 'high' | 'normal' | 'unknown';
    }>;
    source: 'llm' | 'rules' | 'empty';
    error: string | null;
    lineCount?: number;
  }>;
  vaccinationRecords: Array<{
    id: string;
    recordType: 'preventive' | 'ectoparasite';
    doseOrder: string;
    productName: string;
    administeredDate: string | null;
    sign: string | null;
  }>;
  planByDate: Array<{ dateTime: string; rows: PlanRow[] }>;
  vitalsByDate: Array<{
    id: string;
    dateTime: string;
    weight: string | null;
    temperature: string | null;
    respiratoryRate: string | null;
    heartRate: string | null;
    bpSystolic: string | null;
    bpDiastolic: string | null;
    rawText: string | null;
  }>;
  physicalExamByDate: Array<{
    dateTime: string;
    items: Array<{
      id: string;
      itemName: string;
      referenceRange: string | null;
      valueText: string;
      unit: string | null;
      rawText: string | null;
    }>;
  }>;
};
