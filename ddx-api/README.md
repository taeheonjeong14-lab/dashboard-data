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
- In Vercel → **Settings → Environment Variables**, add at least **`DATABASE_URL`** (Supabase Postgres) for **Production** and **Preview** so API routes can talk to the DB at **runtime**. Build no longer requires it, but every Prisma call will fail without it.
- Copy the rest from DDx / `BACKEND_HANDOFF.md` (Supabase, Gemini, OpenAI, Resend, `ADMIN_EMAILS`, `CRON_SECRET`, etc.) as you enable each feature.
- Monorepo: if the Vercel project **root directory** is the repo root, set it to **`ddx-api`** so only this app is built.

## Sync from DDx

When DDx API routes change, re-copy:

- `app/api` → `ddx-api/app/api`
- `lib` → `ddx-api/lib` (server modules used by API)
- `prisma` → `ddx-api/prisma`

Then `npm run build` and fix any drift.

## Prisma

Schema matches Supabase (`core`, `robovet`). Use migrations from `dashboard-data/supabase/migrations` as source of truth for DB shape; do not run `db push` against prod without review.
