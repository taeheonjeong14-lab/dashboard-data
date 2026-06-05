/**
 * Single source for partner-facing docs (/), OpenAPI (/api/openapi), README alignment.
 * Path strings use Next segment syntax [param]; OpenAPI converts to {param}.
 */

export type AvailabilityKind = 'live' | 'requires_gemini' | 'not_implemented_503' | 'mixed';

export type AuthKind = 'bearer_chart' | 'share_token' | 'bearer_cron' | 'public';

export interface ChartApiEndpoint {
  groupId: string;
  methods: string[];
  path: string;
  summaryKo: string;
  detailKo?: string;
  availability: AvailabilityKind;
  auth: AuthKind;
}

export const CHART_API_GROUPS: { id: string; titleKo: string }[] = [
  { id: 'pdf', titleKo: 'A. PDF · 텍스트 버킷팅' },
  { id: 'run-assess', titleKo: 'B. 런 · 추출 · 평가 · 케이스 이미지' },
  { id: 'report', titleKo: 'C. 리포트 · 건강검진 PDF' },
  { id: 'content', titleKo: 'D. 생성 콘텐츠 · 공유 리뷰' },
  { id: 'extras', titleKo: 'E. 건강상식 · OCR · 참고문헌' },
  { id: 'history', titleKo: 'F. 히스토리' },
  { id: 'admin', titleKo: 'G. 관리자 · 크론' },
];

export const CHART_API_ENDPOINTS: ChartApiEndpoint[] = [
  {
    groupId: 'pdf',
    methods: ['POST'],
    path: '/api/text-bucketing/upload-url',
    summaryKo: 'PDF 업로드용 서명 URL 발급',
    detailKo: 'signedUrl 은 가능 시 절대 URL · extract-uploads/… · pdf-uploads',
    availability: 'live',
    auth: 'bearer_chart',
  },
  {
    groupId: 'pdf',
    methods: ['POST'],
    path: '/api/text-bucketing',
    summaryKo: '텍스트 버킷팅 전체 파이프라인',
    detailKo:
      'multipart 권장 · 필수 chartType · 병원 UUID는 hospitalId 또는 hospital_id · file 또는 storageBucket+storagePath(pdf-uploads, extract-uploads/) · 선택 chartPasteText·efriendsChartBlocksJson · LLM 미설정 400 · 30MB · runId·friendlyId · 스캔 PDF 422',
    availability: 'requires_gemini',
    auth: 'bearer_chart',
  },
  {
    groupId: 'run-assess',
    methods: ['PATCH'],
    path: '/api/runs/[runId]/extraction',
    summaryKo: '추출 결과 섹션별 PATCH',
    availability: 'live',
    auth: 'bearer_chart',
  },
  {
    groupId: 'run-assess',
    methods: ['GET', 'POST'],
    path: '/api/runs/[runId]/assessment',
    summaryKo: 'AI 소견 조회 · 생성',
    detailKo: 'POST는 GEMINI_API_KEY 필요, 없으면 503',
    availability: 'mixed',
    auth: 'bearer_chart',
  },
  {
    groupId: 'run-assess',
    methods: ['GET'],
    path: '/api/image-case',
    summaryKo: '케이스 이미지 목록 + 서명 URL',
    detailKo:
      '쿼리 runId 필수. 미리보기 서명 TTL 7일. 버킷 SUPABASE_IMAGE_CASE_BUCKET(선택, 기본 case-image)',
    availability: 'live',
    auth: 'bearer_chart',
  },
  {
    groupId: 'run-assess',
    methods: ['DELETE'],
    path: '/api/image-case',
    summaryKo: '이미지 삭제',
    detailKo: '쿼리 runId, imageId',
    availability: 'live',
    auth: 'bearer_chart',
  },
  {
    groupId: 'extras',
    methods: ['POST'],
    path: '/api/ocr',
    summaryKo: '범용 OCR',
    detailKo: 'Vision 미연동 시 503',
    availability: 'not_implemented_503',
    auth: 'bearer_chart',
  },
  {
    groupId: 'report',
    methods: ['POST'],
    path: '/api/report/generate',
    summaryKo: '리포트 템플릿 생성(Gemini)',
    availability: 'requires_gemini',
    auth: 'bearer_chart',
  },
  {
    groupId: 'report',
    methods: ['POST'],
    path: '/api/report/export',
    summaryKo: '리포트 PDF 바이너리',
    detailKo: 'POST { printUrl } · 인프로세스 Playwright (원격 URL 있으면 우선)',
    availability: 'mixed',
    auth: 'bearer_chart',
  },
  {
    groupId: 'report',
    methods: ['POST'],
    path: '/api/report/health-checkup/preview',
    summaryKo: '건강검진 미리보기(Gemini)',
    availability: 'requires_gemini',
    auth: 'bearer_chart',
  },
  {
    groupId: 'report',
    methods: ['GET', 'POST'],
    path: '/api/report/health-checkup/export',
    summaryKo: '건강검진 PDF',
    detailKo:
      'GET ?runId=&exportRequestId= · POST JSON 또는 form(runId, exportRequestId) · 상관 ID: 헤더 X-Chart-Export-Request-Id 우선 · Playwright · export-debug',
    availability: 'mixed',
    auth: 'bearer_chart',
  },
  {
    groupId: 'report',
    methods: ['POST'],
    path: '/api/report/health-checkup/export-debug',
    summaryKo: '건강검진 PDF export 진단(JSON)',
    detailKo:
      'Bearer 필수 · { runId, probePrintUrl? } · 환경 플래그·인쇄 URL fetch·비밀값 미포함 · Failed to fetch 원인 좁히기',
    availability: 'live',
    auth: 'bearer_chart',
  },
  {
    groupId: 'report',
    methods: ['POST'],
    path: '/api/report/health-checkup/export-by-share',
    summaryKo: '공유 토큰으로 PDF',
    detailKo: '토큰 경로 인쇄 URL · SHARE 템플릿 또는 VET_REPORT_PUBLIC_ORIGIN',
    availability: 'mixed',
    auth: 'share_token',
  },
  {
    groupId: 'content',
    methods: ['POST'],
    path: '/api/content/generate',
    summaryKo: 'health_checkup | blog_post 생성',
    availability: 'requires_gemini',
    auth: 'bearer_chart',
  },
  {
    groupId: 'content',
    methods: ['GET'],
    path: '/api/content',
    summaryKo: 'generated_run_content 목록',
    detailKo: '쿼리 runId',
    availability: 'live',
    auth: 'bearer_chart',
  },
  {
    groupId: 'content',
    methods: ['PATCH'],
    path: '/api/content',
    summaryKo: '콘텐츠 upsert',
    availability: 'live',
    auth: 'bearer_chart',
  },
  {
    groupId: 'content',
    methods: ['DELETE'],
    path: '/api/content',
    summaryKo: '단건 삭제',
    availability: 'live',
    auth: 'bearer_chart',
  },
  {
    groupId: 'content',
    methods: ['POST'],
    path: '/api/content/health-checkup/review-share',
    summaryKo: '외부 리뷰용 공유 링크 발급',
    availability: 'live',
    auth: 'bearer_chart',
  },
  {
    groupId: 'content',
    methods: ['GET'],
    path: '/api/content/health-checkup/review-share',
    summaryKo: '토큰으로 페이로드 조회',
    detailKo: '공개 — 쿼리 token',
    availability: 'live',
    auth: 'public',
  },
  {
    groupId: 'content',
    methods: ['PATCH'],
    path: '/api/content/health-checkup/review-share',
    summaryKo: '토큰으로 검토 반영',
    detailKo: '공개 — 바디에 token',
    availability: 'live',
    auth: 'public',
  },
  {
    groupId: 'content',
    methods: ['POST'],
    path: '/api/content/reference-extract',
    summaryKo: '참고문헌 추출',
    detailKo: 'multipart file= 또는 JSON · fileName·mimeType·fullText·rows',
    availability: 'requires_gemini',
    auth: 'bearer_chart',
  },
  {
    groupId: 'extras',
    methods: ['POST'],
    path: '/api/health-knowledge/generate',
    summaryKo: '건강상식 HTML(Gemini)',
    availability: 'requires_gemini',
    auth: 'bearer_chart',
  },
  {
    groupId: 'history',
    methods: ['GET'],
    path: '/api/history',
    summaryKo: '최근 런 목록 · ?runId= 상세',
    availability: 'live',
    auth: 'bearer_chart',
  },
  {
    groupId: 'history',
    methods: ['DELETE'],
    path: '/api/history/[runId]',
    summaryKo: '런 + 연관 데이터 삭제',
    availability: 'live',
    auth: 'bearer_chart',
  },
  {
    groupId: 'admin',
    methods: ['GET'],
    path: '/api/admin/hospitals',
    summaryKo: '병원 목록',
    availability: 'live',
    auth: 'bearer_chart',
  },
  {
    groupId: 'admin',
    methods: ['POST'],
    path: '/api/admin/hospitals',
    summaryKo: '병원 생성',
    availability: 'live',
    auth: 'bearer_chart',
  },
  {
    groupId: 'admin',
    methods: ['PATCH'],
    path: '/api/admin/hospitals/[id]',
    summaryKo: '병원 수정',
    availability: 'live',
    auth: 'bearer_chart',
  },
  {
    groupId: 'admin',
    methods: ['DELETE'],
    path: '/api/admin/hospitals/[id]',
    summaryKo: '병원 삭제',
    availability: 'live',
    auth: 'bearer_chart',
  },
  {
    groupId: 'admin',
    methods: ['POST'],
    path: '/api/admin/hospitals/[id]/assets',
    summaryKo: 'logo | seal 업로드',
    availability: 'live',
    auth: 'bearer_chart',
  },
  {
    groupId: 'admin',
    methods: ['GET'],
    path: '/api/admin/basic-info-normalization',
    summaryKo: '종·품종 빈도(정규화 통계)',
    availability: 'live',
    auth: 'bearer_chart',
  },
  {
    groupId: 'admin',
    methods: ['GET', 'POST'],
    path: '/api/cron/recompute-basic-info-ages',
    summaryKo: '나이 재계산 크론',
    detailKo: 'CRON_SECRET 설정 시 Bearer 필요',
    availability: 'live',
    auth: 'bearer_cron',
  },
];

export function pathToOpenApi(path: string): string {
  return path.replace(/\[([^\]]+)\]/g, '{$1}');
}

export function availabilityLabelKo(a: AvailabilityKind): string {
  switch (a) {
    case 'live':
      return '동작';
    case 'requires_gemini':
      return 'Gemini 필요';
    case 'not_implemented_503':
      return '503(미포팅)';
    case 'mixed':
      return '혼합(GET 동작 / POST Gemini)';
    default:
      return a;
  }
}

export function authLabelKo(auth: AuthKind): string {
  switch (auth) {
    case 'bearer_chart':
      return 'Bearer CHART_APP_API_KEY';
    case 'share_token':
      return '토큰(쿼리/바디)';
    case 'bearer_cron':
      return 'Bearer CRON_SECRET';
    case 'public':
      return '공개(토큰만 검증)';
    default:
      return auth;
  }
}
