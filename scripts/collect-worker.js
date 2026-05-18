/**
 * collect-worker.js — Supabase Job Queue 폴링 Worker
 *
 * core.collect_jobs 테이블을 30초마다 확인해서
 * pending 상태의 Job을 가져와 collect 스크립트를 실행합니다.
 *
 * Usage:
 *   node scripts/collect-worker.js
 *   npm run collect:worker
 *
 * 필요 환경변수 (.env):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

const { spawn } = require("child_process");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });

const { createClient } = require("@supabase/supabase-js");

const ROOT_DIR = path.resolve(__dirname, "..");
const POLL_INTERVAL_MS = 30_000;
const MAX_CONCURRENT_JOBS = 3;

let runningJobs = 0;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { db: { schema: "analytics" } }
);

function mmdd(ymd) {
  return ymd ? ymd.slice(5) : "";
}

function parseCollectOutput(output) {
  const steps = [];
  const upserts = [];

  const stepRe = /✓\s+(\d+)\/(\d+)\s+완료\s+\(([0-9.]+)s\)\s+[—\-]\s+(.+)/g;
  let m;
  while ((m = stepRe.exec(output)) !== null) {
    steps.push({
      index: parseInt(m[1], 10),
      total: parseInt(m[2], 10),
      durationSec: parseFloat(m[3]),
      name: m[4].trim(),
    });
  }

  const failRe = /✗\s+(\d+)\/(\d+)\s+실패\s+\(([0-9.]+)s\)\s+[—\-]\s+(.+)/g;
  while ((m = failRe.exec(output)) !== null) {
    const raw = m[4].trim();
    const colonIdx = raw.indexOf(":");
    const name = colonIdx > 0 ? raw.slice(0, colonIdx).trim() : raw;
    const error = colonIdx > 0 ? raw.slice(colonIdx + 1).trim() : "";
    steps.push({
      index: parseInt(m[1], 10),
      total: parseInt(m[2], 10),
      durationSec: parseFloat(m[3]),
      name,
      error,
    });
  }

  steps.sort((a, b) => a.index - b.index);

  // 블로그 일별 지표
  const blogRange = /블로그 일별 수집 구간 \(KST\):\s*(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})/.exec(output);
  const blogM = /blog_daily_metrics\s+업서트\s+완료:\s*(\d+)건/.exec(output);
  if (blogM) {
    upserts.push({ label: "블로그 일별 지표", count: parseInt(blogM[1], 10), dateRange: blogRange ? `${mmdd(blogRange[1])} ~ ${mmdd(blogRange[2])}` : null });
  } else if (/blog_daily_metrics 이미 최신입니다/.test(output)) {
    upserts.push({ label: "블로그 일별 지표", count: 0, skipped: true });
  }

  // 스마트플레이스 유입
  const spRange = /스마트플레이스 유입 수집 구간 \(KST\):\s*(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})/.exec(output);
  const spM = /smartplace_daily_metrics\s+업서트\s+완료:\s*(\d+)건/.exec(output);
  if (spM) {
    upserts.push({ label: "스마트플레이스 유입", count: parseInt(spM[1], 10), dateRange: spRange ? `${mmdd(spRange[1])} ~ ${mmdd(spRange[2])}` : null });
  } else if (/smartplace_daily_metrics 이미 최신입니다/.test(output)) {
    upserts.push({ label: "스마트플레이스 유입", count: 0, skipped: true });
  }

  // 블로그 키워드 순위 (여러 건 합산)
  const rankRe = /Supabase\s+업서트\s+완료:\s*(\d+)건\s+\(metric_date=(\d{4}-\d{2}-\d{2})\)/g;
  let rankTotal = 0, rankDate = null;
  while ((m = rankRe.exec(output)) !== null) { rankTotal += parseInt(m[1], 10); rankDate = m[2]; }
  if (rankTotal > 0) upserts.push({ label: "블로그 키워드 순위", count: rankTotal, dateRange: rankDate ? mmdd(rankDate) : null });

  // 플레이스 키워드 순위 (여러 건 합산)
  const placeRankRe = /Supabase\s+플레이스\s+업서트\s+완료:\s*(\d+)건\s+\(metric_date=(\d{4}-\d{2}-\d{2})\)/g;
  let placeTotal = 0, placeDate = null;
  while ((m = placeRankRe.exec(output)) !== null) { placeTotal += parseInt(m[1], 10); placeDate = m[2]; }
  if (placeTotal > 0) upserts.push({ label: "플레이스 키워드 순위", count: placeTotal, dateRange: placeDate ? mmdd(placeDate) : null });

  // SearchAd
  const searchadM = /SearchAd\s+전체\s+처리\s+완료:\s*total_upsert_rows=(\d+)/.exec(output);
  if (searchadM) {
    upserts.push({ label: "SearchAd 광고 성과", count: parseInt(searchadM[1], 10) });
  } else if (/SearchAd 이미 최신/.test(output)) {
    upserts.push({ label: "SearchAd 광고 성과", count: 0, skipped: true });
  }

  return { steps, upserts };
}

function spawnAndCapture(scriptPath, args, extraEnv, onBatchHospitalDone) {
  return new Promise((resolve) => {
    const chunks = [];
    let lineBuffer = "";
    const env = {
      ...process.env,
      COLLECT_ALL_NO_FILE_LOG: "1",
      PYTHONUTF8: "1",
      PYTHONIOENCODING: "utf-8",
      ...extraEnv,
    };
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: ROOT_DIR,
      shell: false,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    function handleLine(line) {
      if (onBatchHospitalDone && line.startsWith("[BATCH_HOSPITAL_DONE] ")) {
        try {
          const marker = JSON.parse(line.slice("[BATCH_HOSPITAL_DONE] ".length));
          onBatchHospitalDone(chunks.join(""), marker);
        } catch { /* 파싱 실패는 무시 */ }
      }
    }

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      chunks.push(chunk);
      lineBuffer += chunk;
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";
      for (const line of lines) handleLine(line);
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (c) => chunks.push(c));
    child.on("error", (err) => {
      chunks.push(`[spawn 오류] ${err.message}\n`);
      resolve({ code: 1, output: chunks.join("") });
    });
    child.on("close", (code) => {
      if (lineBuffer) handleLine(lineBuffer);
      resolve({ code: code ?? 1, output: chunks.join("") });
    });
  });
}

async function pollAndRun() {
  if (runningJobs >= MAX_CONCURRENT_JOBS) return;

  const { data: jobs } = await supabase
    .from("collect_jobs")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1);

  if (!jobs || jobs.length === 0) return;

  const job = jobs[0];

  // 원자적 클레임 — 이미 다른 Worker가 가져갔으면 0건 업데이트
  const { data: claimed } = await supabase
    .from("collect_jobs")
    .update({ status: "running", started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", job.id)
    .eq("status", "pending")
    .select("id")
    .single();

  if (!claimed) return;

  runningJobs++;
  console.log(`[collect-worker] Job 시작: ${job.id} | hospital_id=${job.hospital_id ?? "전체"} (동시 실행: ${runningJobs}/${MAX_CONCURRENT_JOBS})`);

  const isBatch = !job.hospital_id;
  const scriptName = isBatch ? "collect-all-batch.js" : "collect-all.js";
  const scriptPath = path.join(ROOT_DIR, "scripts", scriptName);
  const args = isBatch ? [] : [job.hospital_id];

  const onBatchHospitalDone = isBatch
    ? (accOutput, marker) => {
        console.log(`[collect-worker] 병원 완료 (${marker.index}/${marker.total}): ${marker.hospitalId}`);
        const { steps, upserts } = parseCollectOutput(accOutput);
        supabase
          .from("collect_jobs")
          .update({ steps, upserts, updated_at: new Date().toISOString() })
          .eq("id", job.id)
          .then(() => {})
          .catch(() => {});
      }
    : undefined;

  const extraEnv = job.steps_filter ? { COLLECT_STEPS_FILTER: JSON.stringify(job.steps_filter) } : {};
  try {
    const { code, output } = await spawnAndCapture(scriptPath, args, extraEnv, onBatchHospitalDone);
    const { steps, upserts } = parseCollectOutput(output);
    const status = code === 0 ? "done" : "failed";

    await supabase
      .from("collect_jobs")
      .update({
        status,
        output,
        steps,
        upserts,
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    console.log(`[collect-worker] Job ${status}: ${job.id} (동시 실행: ${runningJobs - 1}/${MAX_CONCURRENT_JOBS})`);
  } finally {
    runningJobs--;
  }
}

console.log(`[collect-worker] 시작 — Supabase 폴링 간격: ${POLL_INTERVAL_MS / 1000}초`);

void pollAndRun();
setInterval(() => void pollAndRun(), POLL_INTERVAL_MS);
