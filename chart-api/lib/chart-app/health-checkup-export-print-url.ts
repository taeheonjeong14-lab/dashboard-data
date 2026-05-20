/** 건강검진 PDF export 가 내부에서 여는 인쇄 페이지 URL (배포 보호 우회 쿼리 포함). */
export function buildHealthCheckupPrintUrlForRequest(requestUrl: string, runId: string): string {
  const origin = new URL(requestUrl).origin;
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  let printUrl = `${origin}/runs/${encodeURIComponent(runId)}/report/print`;
  if (bypass) printUrl += `?x-vercel-protection-bypass=${encodeURIComponent(bypass)}`;
  return printUrl;
}

/** 공유 토큰 기반 인쇄 페이지 URL — /review/health-checkup/{token}/print */
export function buildHealthCheckupSharePrintUrlForRequest(requestUrl: string, shareToken: string): string {
  const origin = new URL(requestUrl).origin;
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  let printUrl = `${origin}/review/health-checkup/${encodeURIComponent(shareToken)}/print`;
  if (bypass) printUrl += `?x-vercel-protection-bypass=${encodeURIComponent(bypass)}`;
  return printUrl;
}
