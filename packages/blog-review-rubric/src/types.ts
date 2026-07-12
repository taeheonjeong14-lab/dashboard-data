/**
 * 블로그 글 검수 — 공통 타입.
 * chart-api(검수 엔진)·admin-web(결과 화면·평가 기준 보기)가 이 타입을 공유한다(드리프트 방지).
 * 설계 근거: docs/blog-review-spec.md
 */

/** 검수 두 축. */
export type Axis = 'medical' | 'seo';

/**
 * 심각도(의학 축 기준 정의, SEO 축도 노출 영향으로 동일 3단계 사용).
 * - high   = 실제 있는 사실과 틀림(내부: 원본 차트와 모순).
 * - medium = 사실은 맞지만 의학적으로 잘못·순서 뒤바뀜·일반 의학 상식에 안 맞음.
 * - low    = 틀린 건 아닌데 오해·과장·불명확.
 */
export type Severity = 'high' | 'medium' | 'low';

/** 앙상블 합의도(몇 개 모델이 같은 문제를 지적했나). */
export type Agreement = '3/3' | '2/3' | '1/3';

/** 신호등. 양호=green / 주의=yellow / 미흡=red. */
export type Light = 'green' | 'yellow' | 'red';

/** 결정적 지표 상태. 양호=good / 주의=warn / 미흡=poor. */
export type MetricStatus = 'good' | 'warn' | 'poor';

/** 검수 대상 출처. */
export type SourceType = 'internal' | 'external';

/** 리뷰어(개별 모델) 1개가 내는 finding. */
export interface ReviewerFinding {
  /** 루브릭 항목 id — 'M1'..'M5' | 'S1'..'S5'. */
  rubricId: string;
  severity: Severity;
  /** 문제가 된 원문 인용(부재형 지적이면 위치 표기 또는 생략). */
  quote?: string;
  /** 무엇이 왜 문제인지 한 문장. */
  issue: string;
  /** 어떻게 고칠지(가능하면 대체 문구). */
  suggestion: string;
  /** (내부) 원본 근거값 / (외부) 원본 대조 필요분은 "출처 대조 불가". */
  evidence?: string;
}

/** 리뷰어 1개의 출력(JSON). */
export interface ReviewerOutput {
  medical: ReviewerFinding[];
  seo: ReviewerFinding[];
}

/** 집계 후 통합 finding(합의도 부여). */
export interface Finding extends ReviewerFinding {
  agreement: Agreement;
}

/** 집계 LLM의 출력(JSON). */
export interface AggregatorOutput {
  medical: Finding[];
  seo: Finding[];
  /** 한국어 한 줄 총평. */
  summary: string;
}

/** 결정적 SEO 지표 1개(지표 스트립 표시용). */
export interface SeoMetric {
  /** 'charCount' | 'imageCount' | 'titleLength' | 'headingCount' | 'tagCount' | 'keywordDensity' | 'titleHasKeyword' | 'titleHasRegion' */
  key: string;
  label: string;
  /** 현재값(숫자 지표) 또는 표시 문자열(포함/없음 등). */
  value: number | string;
  status: MetricStatus;
  /** 사람이 읽는 목표(예: "1200+"). */
  target: string;
  /** 치명 지표 여부(하나만 poor여도 SEO 신호등을 크게 낮춤). */
  critical?: boolean;
}

/** 한 축의 검수 결과(신호등 + 합의/저신뢰 findings). */
export interface AxisReport {
  light: Light;
  /** 2/3·3/3 합의 findings(표시 상단). */
  consensus: Finding[];
  /** 1/3 단일 모델 findings(참고 접힘). */
  lowConfidence: Finding[];
}

/** SEO 축 결과 = 축 리포트 + 결정적 지표 스트립. */
export interface SeoReport extends AxisReport {
  metrics: SeoMetric[];
}

/** 검수 최종 결과(저장·화면 공통). */
export interface BlogReview {
  sourceType: SourceType;
  medical: AxisReport;
  seo: SeoReport;
  /** 게시 부적합(의학 신호등이 red). */
  gated: boolean;
  /** 한 줄 총평(집계 LLM). */
  summary: string;
  /** 사용한 리뷰어 모델 id 목록. */
  modelsUsed: string[];
}

/** 검수 엔진 입력(표준화). groundTruth 있으면 내부 대조 모드, 없으면 외부 지식 모드. */
export interface ReviewInput {
  title: string;
  bodyText: string;
  tags: string[];
  imageCount: number;
  /** 병원명·지역(제목 지역키워드 판정용). 외부는 지정 병원 기준. */
  hospitalName?: string;
  hospitalRegion?: string;
  /** 대표키워드(내부는 자동 도출, 외부는 미상 → 밀도 LLM 판단). */
  keyword?: Keyword | null;
  /** 내부 대조용 원본(외부는 undefined). */
  groundTruth?: string;
}

/** 대표키워드(밀도·제목 포함 판정용). */
export interface Keyword {
  /** 전체(예: "강아지 슬개골 탈구"). */
  full: string;
  /** 핵심 질환 term(예: "슬개골 탈구") — 밀도·제목 포함 판정에 사용. */
  core: string;
  /** 종 표현(예: "강아지"). */
  species: string;
}
