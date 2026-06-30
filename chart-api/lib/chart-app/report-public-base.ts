// 고객용 건강검진 리포트/외부 검토 링크의 공개 도메인.
// 기본 app.thehamm.kr — hospital-web 의 rewrite 가 /review/health-checkup/* 를 chart-api 로 프록시한다.
// (chart-api 의 request origin = chart-api-five.vercel.app 을 고객에게 노출하지 않기 위함)
// env REPORT_PUBLIC_BASE_URL 로 오버라이드 가능.
export function getReportPublicBase(): string {
  return (process.env.REPORT_PUBLIC_BASE_URL?.trim() || 'https://app.thehamm.kr').replace(/\/$/, '');
}
