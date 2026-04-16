/**
 * Supabase 연결·스키마 노출 점검 (collector repo 전용)
 *
 * Usage:
 *   npm run verify:supabase
 *
 * Env:
 *   SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL fallback)
 *   SUPABASE_SERVICE_ROLE_KEY
 */

const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const repoRoot = path.resolve(path.join(__dirname, ".."));
for (const rel of [".env", ".env.local"]) {
  const p = path.join(repoRoot, rel);
  if (fs.existsSync(p)) dotenv.config({ path: p, override: true });
}

const base = String(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ""
)
  .trim()
  .replace(/\/$/, "");
const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const anonKey = String(
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ""
).trim();

async function restGet(pathname, { key, profile }) {
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  if (profile) headers["Accept-Profile"] = profile;
  const res = await fetch(`${base}${pathname}`, { headers });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function ok(message) {
  console.log(`✅ ${message}`);
}

async function main() {
  if (!base) {
    fail(
      "SUPABASE_URL 이 없습니다. collector 루트 `.env` 또는 `.env.local`에 SUPABASE_URL을 넣어 주세요."
    );
  }
  if (!serviceKey) {
    fail("SUPABASE_SERVICE_ROLE_KEY 가 없습니다. service_role 키를 collector 루트 env에 추가하세요.");
  }

  console.log("Supabase 점검 중...\n");

  const hospitals = await restGet("/rest/v1/hospitals?select=id,naver_blog_id&limit=1", {
    key: serviceKey,
    profile: "core",
  });
  if (!hospitals.ok) {
    console.error("core.hospitals 응답:", hospitals.status, hospitals.text.slice(0, 500));
    fail("core 스키마 접근 실패. Data API에서 `core` 노출 여부를 확인하세요.");
  }
  ok("core.hospitals 조회 가능");

  const targets = await restGet("/rest/v1/analytics_blog_keyword_targets?select=id&limit=1", {
    key: serviceKey,
    profile: "analytics",
  });
  if (!targets.ok) {
    console.error(
      "analytics.analytics_blog_keyword_targets 응답:",
      targets.status,
      targets.text.slice(0, 500)
    );
    fail("analytics 스키마 또는 analytics_blog_keyword_targets 접근 실패");
  }
  ok("analytics.analytics_blog_keyword_targets 조회 가능");

  const searchadAccounts = await restGet("/rest/v1/analytics_searchad_accounts?select=id&limit=1", {
    key: serviceKey,
    profile: "analytics",
  });
  if (!searchadAccounts.ok) {
    console.error(
      "analytics.analytics_searchad_accounts 응답:",
      searchadAccounts.status,
      searchadAccounts.text.slice(0, 500)
    );
    fail("analytics_searchad_accounts 접근 실패 (schema.sql 또는 migration 반영 확인)");
  }
  ok("analytics.analytics_searchad_accounts 조회 가능");

  const searchadMetrics = await restGet("/rest/v1/analytics_searchad_daily_metrics?select=metric_date&limit=1", {
    key: serviceKey,
    profile: "analytics",
  });
  if (!searchadMetrics.ok) {
    console.error(
      "analytics.analytics_searchad_daily_metrics 응답:",
      searchadMetrics.status,
      searchadMetrics.text.slice(0, 500)
    );
    fail("analytics_searchad_daily_metrics 접근 실패 (schema.sql 또는 migration 반영 확인)");
  }
  ok("analytics.analytics_searchad_daily_metrics 조회 가능");

  const placeRanks = await restGet("/rest/v1/analytics_place_keyword_ranks?select=metric_date&limit=1", {
    key: serviceKey,
    profile: "analytics",
  });
  if (!placeRanks.ok) {
    console.error(
      "analytics.analytics_place_keyword_ranks 응답:",
      placeRanks.status,
      placeRanks.text.slice(0, 500)
    );
    fail("analytics_place_keyword_ranks 접근 실패 (schema.sql 또는 migration 반영 확인)");
  }
  ok("analytics.analytics_place_keyword_ranks 조회 가능");

  const placeTargets = await restGet("/rest/v1/analytics_place_keyword_targets?select=id&limit=1", {
    key: serviceKey,
    profile: "analytics",
  });
  if (!placeTargets.ok) {
    console.error(
      "analytics.analytics_place_keyword_targets 응답:",
      placeTargets.status,
      placeTargets.text.slice(0, 500)
    );
    fail("analytics_place_keyword_targets 접근 실패 (schema.sql 또는 migration 반영 확인)");
  }
  ok("analytics.analytics_place_keyword_targets 조회 가능");

  const blogDaily = await restGet("/rest/v1/analytics_blog_daily_metrics?select=metric_date&limit=1", {
    key: serviceKey,
    profile: "analytics",
  });
  if (!blogDaily.ok) {
    console.error(
      "analytics.analytics_blog_daily_metrics 응답:",
      blogDaily.status,
      blogDaily.text.slice(0, 500)
    );
    fail("analytics_blog_daily_metrics 접근 실패 (schema.sql 또는 migration 반영 확인)");
  }
  ok("analytics.analytics_blog_daily_metrics 조회 가능");

  const smartplaceDaily = await restGet("/rest/v1/analytics_smartplace_daily_metrics?select=metric_date&limit=1", {
    key: serviceKey,
    profile: "analytics",
  });
  if (!smartplaceDaily.ok) {
    console.error(
      "analytics.analytics_smartplace_daily_metrics 응답:",
      smartplaceDaily.status,
      smartplaceDaily.text.slice(0, 500)
    );
    fail("analytics_smartplace_daily_metrics 접근 실패 (schema.sql 또는 migration 반영 확인)");
  }
  ok("analytics.analytics_smartplace_daily_metrics 조회 가능");

  if (anonKey) {
    const anon = await restGet("/rest/v1/analytics_blog_keyword_targets?select=id&limit=1", {
      key: anonKey,
      profile: "analytics",
    });
    if (anon.status === 401 || anon.status === 403) {
      ok("anon 미인증 접근 차단 정상");
    } else if (anon.ok) {
      console.log("ℹ️ anon 키 접근도 허용됨. RLS 정책 의도 확인 필요");
    }
  }

  console.log("\n완료: collector DB 점검 통과");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
