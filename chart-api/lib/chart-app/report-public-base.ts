// 고객용 건강검진 리포트/외부 검토 링크의 공개 도메인.
// chart-api 에 붙인 브랜드 서브도메인(report.thehamm.kr)으로 서빙 — chart-api 가 자기 도메인에서
// 자기 에셋을 주므로 프록시/CORS 문제 없이 페이지·PDF 모두 통일된다.
// env REPORT_PUBLIC_BASE_URL 로 오버라이드 가능(도메인 설정 전 임시값 등).
export function getReportPublicBase(): string {
  return (process.env.REPORT_PUBLIC_BASE_URL?.trim() || 'https://report.thehamm.kr').replace(/\/$/, '');
}
