import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
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
