/** 대시보드 전용 HTTP API (블로그 미리보기 등). */
const DEFAULT_BASE = "https://dashboard-api-jade.vercel.app";

export function getDashboardApiBaseUrl(): string {
  const v = process.env.NEXT_PUBLIC_DASHBOARD_API_URL;
  if (typeof v === "string" && v.trim() !== "") {
    return v.trim().replace(/\/$/, "");
  }
  return DEFAULT_BASE;
}

export function dashboardBlogPreviewRequestUrl(targetUrl: string): string {
  return `${getDashboardApiBaseUrl()}/api/blog/preview?url=${encodeURIComponent(targetUrl)}`;
}

export function dashboardBlogPreviewImageRequestUrl(imageUrl: string): string {
  return `${getDashboardApiBaseUrl()}/api/blog/preview-image?url=${encodeURIComponent(imageUrl)}`;
}
