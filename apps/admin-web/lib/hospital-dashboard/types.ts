/**
 * 병원 데이터(관리자) 대시보드가 쓰는 행 타입 — hospital-web lib/queries.ts 의 타입을 그대로 옮긴 것.
 * hospital 경영 대시보드와 **같은 화면**을 admin 에서도 그리기 위해 컴포넌트를 복사해 왔고, 그 컴포넌트가 이 타입을 쓴다.
 * ★ hospital 쪽 타입/화면을 바꾸면 여기도 같이 맞춰야 두 화면이 어긋나지 않는다.
 */

/** admin 에서 지정한 키워드 중요도(상/중/하). 목록 정렬 1순위. */
export type KeywordImportance = "high" | "medium" | "low";


/** 일별 KPI 시계열 (경영 통계 페이지). dateKey는 Asia/Seoul 기준 YYYY-MM-DD. */
export type HospitalManagementDayRow = {
  dateKey: string;
  periodType: "day" | "month" | "year";
  sales: number | null;
  visits: number | null;
  newPatients: number | null;
};


export type BlogRankSummaryRow = {
  keyword: string;
  /** admin에서 지정한 키워드 중요도(상/중/하). 정렬 1순위. */
  importance: KeywordImportance;
  blog_rank_tab: number | null;
  blog_rank_general: number | null;
  blog_rank_integrated: number | null;
  blog_rank_pet_popular: number | null;
  blog_rank_tab_trend: -1 | 0 | 1;
  blog_rank_general_trend: -1 | 0 | 1;
  blog_rank_integrated_trend: -1 | 0 | 1;
  blog_rank_pet_popular_trend: -1 | 0 | 1;
  blog_rank_tab_url: string | null;
  blog_rank_general_url: string | null;
  blog_rank_integrated_url: string | null;
  blog_rank_pet_popular_url: string | null;
  /** 가장 최근 수집일 (Asia/Seoul YYYY-MM-DD). 모든 row 동일 값. */
  latestDateKey: string | null;
  /** 화살표 비교 기준이 된 수집일(약 14일 전, 폴백 적용 후). 모든 row 동일 값. */
  baselineDateKey: string | null;
};


/** 블로그 KPI 시계열 (analytics.chart_blog_period_view). dateKey는 Asia/Seoul 기준 YYYY-MM-DD. */
export type BlogPeriodDayRow = {
  dateKey: string;
  periodType: "day" | "month" | "year";
  views: number | null;
  uniqueVisitors: number | null;
};


export type BlogRankTrendPoint = {
  dateKey: string;
  blog_rank_tab: number | null;
  blog_rank_general: number | null;
  blog_rank_integrated: number | null;
  blog_rank_pet_popular: number | null;
};


export type PlaceRankSummaryRow = {
  keyword: string;
  /** admin에서 지정한 키워드 중요도(상/중/하). 정렬 1순위. */
  importance: KeywordImportance;
  rank_value: number | null;
  /** 14일 전(폴백 적용) 대비 순위 변동. 1=상승(숫자↓), -1=하락, 0=동일/비교불가 */
  rank_value_trend: -1 | 0 | 1;
  /** 가장 최근 수집일 (Asia/Seoul YYYY-MM-DD). 모든 row 동일 값. */
  latestDateKey: string | null;
  /** 화살표 비교 기준이 된 수집일(약 14일 전, 폴백 적용 후). 모든 row 동일 값. */
  baselineDateKey: string | null;
};


/** 플레이스 리뷰 통계 (최근 6개월) — analytics.analytics_place_reviews 집계. */
export type PlaceReviewStats = {
  /** 최근 6개월 월별 리뷰 수 (오래된→최신, 6개) */
  monthly: { monthKey: string; monthLabel: string; count: number }[];
  /** 5단계 감성 분포 카운트 */
  strongPositiveCount: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
  strongNegativeCount: number;
  /** 최근 6개월 부정 리뷰 목록 (강한 부정 먼저). strong=강한 부정 */
  negativeReviews: {
    reviewDate: string;
    authorId: string | null;
    content: string | null;
    strong: boolean;
  }[];
};


/** 플레이스 KPI 시계열 (analytics.chart_place_period_view). */
export type PlacePeriodDayRow = {
  dateKey: string;
  periodType: "day" | "month" | "year";
  inflow: number | null;
};


/** 네이버 검색광고 일별 성과 (analytics.analytics_searchad_daily_metrics).
 *  campaign/adgroup/keyword 레벨이 ID 채움 패턴으로 구분돼 한 테이블에 섞여 있음. */
export type SearchAdRow = {
  dateKey: string;
  campaignId: string;
  campaignName: string | null;
  campaignType: string | null;
  adgroupId: string;
  adgroupName: string | null;
  keywordId: string;
  keywordName: string | null;
  impressions: number;
  clicks: number;
  cost: number;
};

