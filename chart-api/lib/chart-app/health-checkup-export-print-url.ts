// Deployment Protection 우회 쿼리. 쿼리 파라미터만으론 '그 요청 1건'만 우회되어,
// Playwright 가 인쇄 페이지를 열 때 페이지가 로드하는 같은 도메인 하위 리소스(로고·seal·
// 표지 이미지 등 Vercel 정적 자산)는 우회 토큰이 없어 401 로 막혀 깨진다.
// x-vercel-set-bypass-cookie=true 를 함께 주면 Vercel 이 우회 쿠키를 내려주고,
// 브라우저가 이후 모든 같은 도메인 하위 요청에 쿠키를 실어 보내 이미지가 정상 로드된다.
function appendBypassQuery(printUrl: string): string {
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (!bypass) return printUrl;
  const sep = printUrl.includes('?') ? '&' : '?';
  return `${printUrl}${sep}x-vercel-protection-bypass=${encodeURIComponent(bypass)}&x-vercel-set-bypass-cookie=true`;
}

/** 건강검진 PDF export 가 내부에서 여는 인쇄 페이지 URL (배포 보호 우회 쿼리 포함). */
export function buildHealthCheckupPrintUrlForRequest(requestUrl: string, runId: string): string {
  const origin = new URL(requestUrl).origin;
  return appendBypassQuery(`${origin}/runs/${encodeURIComponent(runId)}/report/print`);
}

/** 공유 토큰 기반 인쇄 페이지 URL — /review/health-checkup/{token}/print */
export function buildHealthCheckupSharePrintUrlForRequest(requestUrl: string, shareToken: string): string {
  const origin = new URL(requestUrl).origin;
  return appendBypassQuery(`${origin}/review/health-checkup/${encodeURIComponent(shareToken)}/print`);
}
