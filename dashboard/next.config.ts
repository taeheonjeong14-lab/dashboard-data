import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

function allowedDevOriginsFromEnv(): string[] {
  const raw = process.env.ALLOWED_DEV_ORIGINS;
  const extra = raw
    ? raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const defaults = ["localhost", "127.0.0.1", "::1", "[::1]"];
  return [...new Set([...defaults, ...extra])];
}

const nextConfig: NextConfig = {
  // 개발 모드에서 LAN 등 추가 오리진: .env.local 에 ALLOWED_DEV_ORIGINS=192.168.x.x,10.x.x.x
  allowedDevOrigins: allowedDevOriginsFromEnv(),
  // Monorepo에 상위 package-lock이 있으면 Turbopack이 루트를 잘못 잡아
  // dashboard/middleware.ts가 무시될 수 있음 → 앱 디렉터리를 명시
  turbopack: {
    root: rootDir,
  },
};

export default nextConfig;
