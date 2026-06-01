import path from 'path';
import type { NextConfig } from 'next';

/** npm workspaces면 `next`가 레포 루트 node_modules에만 있어 Turbopack이 패키지를 못 찾는다. 루트를 레포 루트로 둔다. */
/* 배포: GHA는 레포 루트에서 vercel build 실행(working-directory 미사용), Vercel Root Directory=apps/hospital-web. */
const repoRoot = path.join(__dirname, '..', '..');

const nextConfig: NextConfig = {
  transpilePackages: ['@dashboard/chart-ingest'],
  turbopack: {
    root: repoRoot,
  },
};

export default nextConfig;
