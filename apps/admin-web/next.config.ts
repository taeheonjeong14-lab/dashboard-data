import path from 'path';
import type { NextConfig } from 'next';

const repoRoot = path.join(__dirname, '..', '..');

const nextConfig: NextConfig = {
  transpilePackages: ['@dashboard/lab-normalize'],
  turbopack: {
    root: repoRoot,
  },
};

export default nextConfig;
