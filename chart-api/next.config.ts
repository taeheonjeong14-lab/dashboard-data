import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  allowedDevOrigins: ['*.ngrok-free.app', '*.ngrok-free.dev', '*.ngrok.io', '*.ngrok.app'],
  serverExternalPackages: ['@sparticuz/chromium', 'playwright-core'],
  outputFileTracingIncludes: {
    // Include the whole package so the binary (if present after npm install) is bundled.
    // v130+ no longer ships the binary in npm; executablePath() downloads to /tmp at runtime.
    '/api/report/health-checkup/export': ['./node_modules/@sparticuz/chromium/**'],
    '/api/report/health-checkup/export-by-share': ['./node_modules/@sparticuz/chromium/**'],
  },
};

export default nextConfig;
