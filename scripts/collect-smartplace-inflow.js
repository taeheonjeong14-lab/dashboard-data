/**
 * 네이버 스마트플레이스 유입수 수집 - DB 전용 분리 실행
 *
 * 저장 테이블: analytics.analytics_smartplace_daily_metrics
 *
 * Usage:
 *   node scripts/collect-smartplace-inflow.js [blogId]
 */

const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const CONFIG_PATH = path.join(__dirname, "..", "config.json");
const { getKstYesterdayString, computeMetricRange, INITIAL_BACKFILL_DAYS } = require("./lib/metricDateRange");

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function resolveChromePort(config, hospitalId) {
  const envPort = Number(process.env.COLLECT_CHROME_DEBUGGING_PORT || "");
  if (Number.isFinite(envPort) && envPort > 0) return envPort;
  const byHospital = config?.hospitalPorts?.[hospitalId];
  const parsedHospital = typeof byHospital === "number" ? byHospital : Number(byHospital);
  if (Number.isFinite(parsedHospital) && parsedHospital > 0) return parsedHospital;
  const fallback = config?.chrome?.debuggingPort ?? 9222;
  const parsedFallback = typeof fallback === "number" ? fallback : Number(fallback);
  return Number.isFinite(parsedFallback) && parsedFallback > 0 ? parsedFallback : 9222;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function setUrlDateParams(url, startDate, endDate) {
  const u = new URL(url);
  u.searchParams.set("startDate", startDate);
  u.searchParams.set("endDate", endDate);
  u.searchParams.set("term", "daily");
  return u.toString();
}

async function connectBrowser(port) {
  return await puppeteer.connect({
    browserURL: `http://127.0.0.1:${port}`,
    defaultViewport: null,
  });
}

async function getPageBody(page) {
  const bodies = [];
  for (const frame of page.frames()) {
    try {
      const body = await Promise.race([
        frame.evaluate(() => (document.body && document.body.innerText) || ""),
        new Promise((_, rej) => setTimeout(() => rej(new Error("t")), 3000)),
      ]).catch(() => "");
      if (body && body.length > 20) bodies.push(body);
    } catch (e) {}
  }
  const main = await page.evaluate(() => (document.body && document.body.innerText) || "").catch(() => "");
  if (main && main.length > 20) bodies.push(main);
  return bodies.join("\n") || main;
}

function parsePlaceInflowSingle(body) {
  const m = body.match(/플레이스\s*유입[\s\S]*?([0-9,]+)\s*회\s*전일/);
  return m ? parseInt(String(m[1]).replace(/,/g, ""), 10) : null;
}

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

async function resolveHospitalByBlogId(supabase, blogId) {
  if (!blogId || !String(blogId).trim()) return { hospitalId: null, hospitalName: null };
  const normalizedBlogId = String(blogId).trim();
  const coreResult = await supabase
    .schema("core")
    .from("hospitals")
    .select("id,name,smartplace_stat_url")
    .eq("naver_blog_id", normalizedBlogId)
    .limit(1);

  if (coreResult.error) throw coreResult.error;
  if (!coreResult.data || coreResult.data.length === 0) {
    return { hospitalId: null, hospitalName: null, smartplaceStatUrl: null };
  }
  return {
    hospitalId: String(coreResult.data[0].id),
    hospitalName: coreResult.data[0].name || null,
    smartplaceStatUrl: coreResult.data[0].smartplace_stat_url || null,
  };
}

async function fetchMaxSmartplaceMetricDate(supabase, accountId) {
  const { data, error } = await supabase
    .schema("analytics")
    .from("analytics_smartplace_daily_metrics")
    .select("metric_date")
    .eq("account_id", accountId)
    .order("metric_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.metric_date == null) return null;
  return String(data.metric_date).slice(0, 10);
}

async function scrapeSmartPlaceInflow(page, statUrl, startDate, endDate) {
  const daysToFetch = [];
  const days = Math.max(0, Math.floor((new Date(endDate) - new Date(startDate)) / (24 * 3600 * 1000)));
  for (let i = 0; i <= days; i++) daysToFetch.push(addDays(startDate, i));

  const rows = [];
  for (let i = 0; i < daysToFetch.length; i++) {
    const day = daysToFetch[i];
    const url = setUrlDateParams(statUrl.trim(), day, day);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await new Promise((r) => setTimeout(r, 2000));
    const body = await getPageBody(page);
    const inflow = parsePlaceInflowSingle(body);
    rows.push({ metric_date: day, smartplace_inflow: inflow !== null ? inflow : null });
  }
  return rows;
}

async function upsertSmartplaceDailyMetrics(supabase, accountId, hospitalId, hospitalName, rows) {
  if (!rows || rows.length === 0) return 0;
  const collectedAt = new Date().toISOString();
  const payload = rows.map((r) => ({
    account_id: accountId,
    hospital_id: hospitalId,
    hospital_name: hospitalName,
    metric_date: r.metric_date,
    smartplace_inflow: r.smartplace_inflow,
    metadata: {},
    collected_at: collectedAt,
  }));

  const { error } = await supabase
    .schema("analytics")
    .from("analytics_smartplace_daily_metrics")
    .upsert(payload, { onConflict: "account_id,metric_date" });
  if (error) throw error;
  return payload.length;
}

async function main() {
  const config = loadConfig();
  const arg = process.argv[2];
  const id = (arg && arg.trim()) || config.blog?.blogId?.trim();
  if (!id) {
    console.error("blogId를 지정해 주세요. 예: node scripts/collect-smartplace-inflow.js howtoanimal");
    process.exit(1);
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 없어 DB 저장을 할 수 없습니다.");
    process.exit(1);
  }

  const { hospitalId, hospitalName, smartplaceStatUrl: dbSmartplaceStatUrl } = await resolveHospitalByBlogId(supabase, id).catch(() => ({
    hospitalId: null,
    hospitalName: null,
    smartplaceStatUrl: null,
  }));
  const port = resolveChromePort(config, hospitalId);
  const account = config.accounts && config.accounts[id];
  const smartplaceStatUrl = dbSmartplaceStatUrl || (account && account.smartplaceStatUrl) || config.smartplace?.statUrl;
  if (!smartplaceStatUrl) {
    console.error(
      "smartplaceStatUrl이 없습니다. core.hospitals.smartplace_stat_url 또는 config.smartplace.statUrl/accounts.<id>.smartplaceStatUrl을 설정하세요."
    );
    process.exit(1);
  }

  const endDate = getKstYesterdayString();
  const maxMetric = await fetchMaxSmartplaceMetricDate(supabase, id);
  const initialDays = Number(process.env.SMARTPLACE_METRICS_INITIAL_DAYS || INITIAL_BACKFILL_DAYS) || INITIAL_BACKFILL_DAYS;
  const range = computeMetricRange(maxMetric, endDate, initialDays);
  if (range.empty) {
    console.log(
      "ℹ️ smartplace_daily_metrics 이미 최신입니다. (KST end=%s, DB max=%s → start=%s)",
      endDate,
      maxMetric ?? "(없음)",
      range.startDate
    );
    return;
  }
  const startDate = range.startDate;
  console.log("스마트플레이스 유입 수집 구간 (KST): %s ~ %s (DB max=%s)", startDate, endDate, maxMetric ?? "없음");

  console.log("Chrome에 연결 중... (포트 %s, hospital_id=%s)", port, hospitalId || "-");
  const browser = await connectBrowser(port);
  const page = (await browser.pages())[0] || (await browser.newPage());

  try {
    const rows = await scrapeSmartPlaceInflow(page, smartplaceStatUrl, startDate, endDate);
    const count = await upsertSmartplaceDailyMetrics(supabase, id, hospitalId, hospitalName, rows);
    console.log("✅ smartplace_daily_metrics 업서트 완료: %d건 (KST end=%s)", count, endDate);
  } finally {
    await browser.disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

