# ddx-api

Next.js (App Router) **HTTP API only** — route handlers copied from the DDx app so this repo can host a dedicated BFF. Same paths as production DDx: `/api/*`.

## Run

```bash
cd ddx-api
cp .env.example .env.local   # fill in values
npm install
npm run dev                 # http://localhost:3001
```

`npm run build` needs `DATABASE_URL` set (any valid connection string for `prisma generate` / Prisma init at import time).

## Deploy (Vercel)

- **Project** is linked as `ddx-api` (subdirectory of this repo). **Production URL:** `https://ddx-api.vercel.app` (alias; each deploy also gets a `*.vercel.app` URL).
- **Root Directory:** **`ddx-api`** (레포 루트가 아님).
- **Monorepo 설치:** 루트에만 `package-lock.json` 이 있으므로 `ddx-api/vercel.json` 에서 **`cd .. && npm ci`** 로 상위에서 워크스페이스 전체를 설치하고, **`cd .. && npm run ddx-api:build`** 로 빌드합니다. 배포가 깨지면 로그에 `npm ci` / lockfile / 워크스페이스 관련 에러가 있는지 확인하세요.
- In Vercel → **Settings → Environment Variables**, add at least **`DATABASE_URL`** (Supabase Postgres) for **Production** and **Preview** so API routes can talk to the DB at **runtime**. Build no longer requires it, but every Prisma call will fail without it.
- Copy the rest from DDx / `BACKEND_HANDOFF.md` (Supabase, Gemini, OpenAI, Resend, `ADMIN_EMAILS`, `CRON_SECRET`, etc.) as you enable each feature.
- **내부 관리자:** DB `core.admin_users` (`id` = Supabase Auth uid). 병원 사용자는 `core.users` 만 사용. `ADMIN_EMAILS` / `core.users.role = admin` 은 마이그레이션 폴백 (`lib/admin.ts`).

## Sync from DDx

When DDx API routes change, re-copy:

- `app/api` → `ddx-api/app/api`
- `lib` → `ddx-api/lib` (server modules used by API)
- `prisma` → `ddx-api/prisma`

Then `npm run build` and fix any drift.

## Prisma

Schema matches Supabase (`core`, `robovet`). Use migrations from `dashboard-data/supabase/migrations` as source of truth for DB shape; do not run `db push` against prod without review.

진료 차트·건강검진(vet-report 호환) API는 **`chart-api`** 디렉터리의 별도 Next 앱으로 분리되어 있습니다.
