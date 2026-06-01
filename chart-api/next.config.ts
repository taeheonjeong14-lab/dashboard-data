import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  // 모노레포 루트를 명시 — Turbopack이 워크스페이스 루트를 잘못 추론해 next/package.json을
  // 못 찾고, chart-api 바깥의 공유 패키지(packages/*)도 컴파일 못 하던 빌드 에러 방지.
  // (루트 = chart-api 의 상위 = 레포 루트)
  // 참고: NEXT_PUBLIC_* 는 일반(비-Sensitive) 변수여야 vercel pull/build 가 값을 inline 함.
  turbopack: {
    root: path.join(__dirname, '..'),
  },
  transpilePackages: ['@dashboard/lab-normalize'],
  allowedDevOrigins: ['*.ngrok-free.app', '*.ngrok-free.dev', '*.ngrok.io', '*.ngrok.app'],
  serverExternalPackages: ['@sparticuz/chromium', 'playwright-core'],
  // bin/chromium.br is 64 MB — Vercel Hobby (50 MB/fn limit) will silently drop it.
  // We fall back to a GitHub Releases URL download in playwright-browser.ts.
  // On Pro (250 MB limit) the binary would fit, so keep the tracing include so it
  // gets bundled when available, avoiding the cold-start download penalty.
  outputFileTracingIncludes: {
    '/api/report/health-checkup/export': ['./node_modules/@sparticuz/chromium/bin/**'],
    '/api/report/health-checkup/export-by-share': ['./node_modules/@sparticuz/chromium/bin/**'],
  },
};

export default nextConfig;
