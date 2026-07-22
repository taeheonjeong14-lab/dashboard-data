import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 공유 패키지(워크스페이스 소스 TS) 트랜스파일 — @dashboard/breeds(품종 단일 소스)
  transpilePackages: ['@dashboard/breeds', '@dashboard/error-log'],
  // Match DDx: allow tunnel dev origins if needed
  allowedDevOrigins: ['*.ngrok-free.app', '*.ngrok-free.dev', '*.ngrok.io', '*.ngrok.app'],
};

export default nextConfig;
