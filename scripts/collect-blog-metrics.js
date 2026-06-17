/**
 * 네이버 블로그 관리자 통계 수집 (조회수/순방문자수) - DB 전용 분리 실행
 *
 * 저장 테이블: analytics.analytics_blog_daily_metrics
 *
 * Usage:
 *   node scripts/collect-blog-metrics.js [blogId]
 */

const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const CONFIG_PATH = path.join(__dirname, "..", "config.json");
const ADMIN_BASE = "https://admin.blog.naver.com";
const { getKstYesterdayString, computeMetricRange, INITIAL_BACKFILL_DAYS } = require("./lib/metricDateRange");

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

// 사람처럼 보이는 랜덤 대기(고정 간격은 봇 신호). 로그인 세션이라 균일한 패턴이 계정 보안체크를 부를 수 있어
// 페이지 이동·페이지네이션 사이를 랜덤화한다. LOGIN_COLLECT_DELAY_MIN_MS/MAX_MS 로 전역 조정.
function jitter(minMs, maxMs) {
  const lo = Number(process.env.LOGIN_COLLECT_DELAY_MIN_MS) || minMs;
  const hi = Number(process.env.LOGIN_COLLECT_DELAY_MAX_MS) || maxMs;
  const ms = Math.floor(lo + Math.random() * Math.max(0, hi - lo));
  return new Promise((r) => setTimeout(r, ms));
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
    .select("id,name")
    .eq("naver_blog_id", normalizedBlogId)
    .limit(1);

  if (coreResult.error) throw coreResult.error;
  if (!coreResult.data || coreResult.data.length === 0) return { hospitalId: null, hospitalName: null };
  return { hospitalId: String(coreResult.data[0].id), hospitalName: coreResult.data[0].name || null };
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

function parseTableRows(body) {
  const rows = [];
  const re = /(\d{4})\.(\d{2})\.(\d{2})\.\s*\([^)]+\)[\t\s]+(\d+)/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const dateStr = `${m[1]}-${m[2]}-${m[3]}`;
    const value = parseInt(m[4], 10);
    rows.push({ date: dateStr, value });
  }
  return rows;
}

/** startDate까지 이전 버튼을 눌러가며 모든 페이지 수집 */
async function scrapeWithPagination(page, url, label, startDate) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await jitter(3500, 5500);

  const allRows = [];

  // 버튼 1번 = 하루 이동이므로 90일 백필 시 최대 ~75번 필요. 여유분 포함 200번 상한.
  const today = new Date().toISOString().slice(0, 10);
  const totalDays = Math.ceil((new Date(today) - new Date(startDate)) / (24 * 3600 * 1000));
  const maxClicks = totalDays + 5;

  for (let click = 0; click < maxClicks; click++) {
    const body = await getPageBody(page);
    const rows = parseTableRows(body);
    if (rows.length === 0) break;
    allRows.push(...rows);

    const minDate = rows.reduce((min, r) => (r.date < min ? r.date : min), rows[0].date);
    if (minDate <= startDate) break;

    // iframe 포함 전체 프레임에서 버튼 탐색
    let prevBtn = null;
    let prevFrame = null;
    for (const frame of page.frames()) {
      try {
        const btn = await frame.$("a.u_ni_btn_prev.u_ni_is_active").catch(() => null);
        if (btn) { prevBtn = btn; prevFrame = frame; break; }
      } catch { /* 무시 */ }
    }
    if (!prevBtn) break;

    if (click % 10 === 0) console.log("%s 이전 이동 중... (%d번째, minDate=%s)", label, click + 1, minDate);
    await prevBtn.click();
    await jitter(1300, 2600);
  }

  return allRows;
}

/** startDate 이전까지 페이지네이션하며 수집 */
async function scrapeBlogMetrics(page, blogId, config, startDate) {
  const visitPvUrl = config.blog?.visitPvUrl || `${ADMIN_BASE}/${blogId}/stat/visit_pv`;
  const uvUrl = config.blog?.uvUrl || `${ADMIN_BASE}/${blogId}/stat/uv`;

  const emitProgress = (done, label) =>
    process.stdout.write(
      "__PROGRESS__ " + JSON.stringify({ step: "blog_metrics", done, total: 2, label }) + "\n"
    );

  console.log("조회수 페이지 로드 중...");
  emitProgress(0, "조회수 수집 중");
  const pvRows = await scrapeWithPagination(page, visitPvUrl, "조회수", startDate);

  console.log("순방문자수 페이지 로드 중...");
  emitProgress(1, "순방문자수 수집 중");
  const uvRows = await scrapeWithPagination(page, uvUrl, "순방문자수", startDate);
  emitProgress(2, "완료");

  const uvByDate = {};
  uvRows.forEach((r) => { uvByDate[r.date] = r.value; });

  const merged = [];
  const seen = new Set();
  for (const pv of pvRows) {
    if (seen.has(pv.date)) continue;
    seen.add(pv.date);
    merged.push({
      metric_date: pv.date,
      blog_views: pv.value,
      blog_unique_visitors: uvByDate[pv.date] ?? null,
    });
  }
  merged.sort((a, b) => (a.metric_date < b.metric_date ? -1 : a.metric_date > b.metric_date ? 1 : 0));
  return merged;
}

async function fetchMaxBlogMetricDate(supabase, accountId) {
  const { data, error } = await supabase
    .schema("analytics")
    .from("analytics_blog_daily_metrics")
    .select("metric_date")
    .eq("account_id", accountId)
    .order("metric_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.metric_date == null) return null;
  return String(data.metric_date).slice(0, 10);
}

async function upsertBlogDailyMetrics(supabase, accountId, hospitalId, hospitalName, rows) {
  if (!rows || rows.length === 0) return 0;
  const collectedAt = new Date().toISOString();
  const payload = rows.map((r) => ({
    account_id: accountId,
    hospital_id: hospitalId,
    hospital_name: hospitalName,
    metric_date: r.metric_date,
    blog_views: r.blog_views,
    blog_unique_visitors: r.blog_unique_visitors,
    metadata: {},
    collected_at: collectedAt,
  }));

  const { error } = await supabase
    .schema("analytics")
    .from("analytics_blog_daily_metrics")
    .upsert(payload, { onConflict: "account_id,metric_date" });
  if (error) throw error;
  return payload.length;
}

async function main() {
  const config = loadConfig();
  const arg = process.argv[2];
  const id = (arg && arg.trim()) || config.blog?.blogId?.trim();
  if (!id) {
    console.error("blogId를 지정해 주세요. 예: node scripts/collect-blog-metrics.js howtoanimal");
    process.exit(1);
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 없어 DB 저장을 할 수 없습니다.");
    process.exit(1);
  }

  const { hospitalId, hospitalName } = await resolveHospitalByBlogId(supabase, id).catch(() => ({
    hospitalId: null,
    hospitalName: null,
  }));
  const port = resolveChromePort(config, hospitalId);

  const endDate = getKstYesterdayString();
  const maxMetric = await fetchMaxBlogMetricDate(supabase, id);
  const initialDays = Number(process.env.BLOG_METRICS_INITIAL_DAYS || INITIAL_BACKFILL_DAYS) || INITIAL_BACKFILL_DAYS;
  const range = computeMetricRange(maxMetric, endDate, initialDays);
  if (range.empty) {
    console.log(
      "ℹ️ blog_daily_metrics 이미 최신입니다. (KST end=%s, DB max=%s → start=%s)",
      endDate,
      maxMetric ?? "(없음)",
      range.startDate
    );
    return;
  }
  console.log("블로그 일별 수집 구간 (KST): %s ~ %s (DB max=%s)", range.startDate, range.endDate, maxMetric ?? "없음");

  console.log("Chrome에 연결 중... (포트 %s, hospital_id=%s)", port, hospitalId || "-");
  const browser = await connectBrowser(port);
  const page = await browser.newPage();

  try {
    const merged = await scrapeBlogMetrics(page, id, config, range.startDate);
    const rows = merged.filter((r) => r.metric_date >= range.startDate && r.metric_date <= range.endDate);
    if (rows.length === 0) {
      console.log(
        "ℹ️ 네이버 통계 표에 해당 구간(%s~%s) 데이터가 없습니다. 표에 노출되는 일수를 확인하세요.",
        range.startDate,
        range.endDate
      );
      return;
    }
    const count = await upsertBlogDailyMetrics(supabase, id, hospitalId, hospitalName, rows);
    console.log("✅ blog_daily_metrics 업서트 완료: %d건 (KST end=%s)", count, endDate);
  } finally {
    await page.close().catch(() => {});
    await browser.disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

