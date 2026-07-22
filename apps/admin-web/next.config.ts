import path from 'path';
import type { NextConfig } from 'next';

const repoRoot = path.join(__dirname, '..', '..');

const nextConfig: NextConfig = {
  transpilePackages: ['@dashboard/lab-normalize', '@dashboard/chart-ingest', '@dashboard/health-report', '@dashboard/blog-review-rubric', '@dashboard/error-log'],
  turbopack: {
    root: repoRoot,
  },
};

export default nextConfig;
