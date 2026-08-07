export type BasicInfo = {
  hospitalName: string | null;
  ownerName: string | null;
  patientName: string | null;
  species: string | null;
  breed: string | null;
  birth: string | null;
  age: number | null;
  sex: string | null;
};

export type ReportChartBodyByDate = {
  dateTime: string;
  bodyText: string;
  planText: string;
  lineCount: number;
  planDetected: boolean;
};

export type ReportLabItemsByDate = {
  dateTime: string;
  items: Array<{
    itemName: string;
    valueText: string;
    unit: string | null;
    referenceRange: string | null;
    flag: 'low' | 'high' | 'normal' | 'unknown';
  }>;
  source: 'llm' | 'rules' | 'empty';
  error: string | null;
  lineCount: number;
};

export type VaccinationRecord = {
  recordType: 'preventive' | 'ectoparasite';
  doseOrder: string;
  productName: string;
  administeredDate: string | null;
  sign: string | null;
};

export type PlanByDate = {
  dateTime: string;
  rows: Array<{
    code: string | null;
    treatmentPrescription: string | null;
    qty: string | null;
    unit: string | null;
    day: string | null;
    total: string | null;
    route: string | null;
    signId: string | null;
    rawText: string | null;
  }>;
};

export type ReportCaseImage = {
  id: string;
  /** ⚠ 실제 촬영일이 아니라 **DB 저장일(업로드한 날)** 이다. 건강검진 리포트의 검진일 필터가 이 값에 의존한다. */
  examDate: string;
  /** 실제 촬영일(모르면 ''). 진료케이스의 날짜 앵커는 이것만 쓴다 — 업로드일을 촬영일로 착각해 '오늘'이 최초 진단일이 되지 않도록. */
  examDateExact?: string;
  fileName: string;
  examType: 'radiology' | 'ultrasound' | 'other';
  radiologySub: 'thorax' | 'abdomen' | 'joint' | 'dental' | null;
  briefComment: string;
  hasNotableFinding: boolean;
  storagePath: string;
  imageUrl: string | null;
  createdAt: string;
};

export type ReportSourceData = {
  run: {
    id: string;
    createdAt: string;
    friendlyId: string | null;
    provider: string | null;
    model: string | null;
    parserVersion: string | null;
    fileName: string | null;
    chartType: 'intovet' | 'efriends' | 'plusvet' | 'other' | 'woorien_pms';
  };
  basicInfo: BasicInfo | null;
  chartBodyByDate: ReportChartBodyByDate[];
  labItemsByDate: ReportLabItemsByDate[];
  vaccinationRecords: VaccinationRecord[];
  planByDate: PlanByDate[];
  physicalExamItemsByDate: Array<{
    dateTime: string;
    items: Array<{
      itemName: string;
      referenceRange: string | null;
      valueText: string;
      unit: string | null;
      rawText: string | null;
    }>;
  }>;
  /** chart_pdf.result_vitals — 차트의 바이탈 행(체중·체온·심박 등). 표지 체중을 여기서 채운다. */
  vitalsByDate: Array<{
    dateTime: string;
    weight: string | null;
    temperature: string | null;
    respiratoryRate: string | null;
    heartRate: string | null;
    bpSystolic: string | null;
    bpDiastolic: string | null;
  }>;
  caseImages: ReportCaseImage[];
  /**
   * chart_pdf.parse_run_case_image_summaries — 이미지 **그룹(검사일)** 단위 판독 요약.
   * 장별 코멘트(brief_comment)는 지금 아무도 쓰지 않는다(라벨링은 종류·부위만 채운다) — 실제
   * 판독 내용은 전부 여기 bullets 에 있다. 이걸 안 실으면 리포트·검진 포인트에 이미지 근거가
   * 한 줄도 들어가지 않는다.
   */
  caseImageSummaries: Array<{ examDate: string; bullets: string[] }>;
};

/** vet-report `report-template` 컴포넌트 호환 (미래 `/report/generate` 등) */
export type ReportTemplateModel = {
  header: {
    title: string;
    generatedAtIso: string;
    runFriendlyId: string | null;
  };
  patient: BasicInfo | null;
  summary: {
    oneLineSummary: string;
    keyFindings: string[];
    notableAbnormalities: string[];
    recommendations: string[];
    followUpPlan: string;
    imageSummary: string;
    disclaimer: string;
  };
  images: Array<{
    imageId: string;
    examDate: string;
    fileName: string;
    examTypeLabel: string;
    imageUrl: string | null;
    briefComment: string;
    caption: string;
  }>;
};
