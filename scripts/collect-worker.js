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

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { db: { schema: "core" } }
);

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

  const blogM = /blog_daily_metrics\s+업서트\s+완료:\s*(\d+)건/.exec(output);
  if (blogM) upserts.push({ label: "블로그 일별 지표", count: parseInt(blogM[1], 10) });

  const spM = /smartplace_daily_metrics\s+업서트\s+완료:\s*(\d+)건/.exec(output);
  if (spM) upserts.push({ label: "스마트플레이스 유입", count: parseInt(spM[1], 10) });

  const rankM = /Supabase\s+업서트\s+완료:\s*(\d+)건/.exec(output);
  if (rankM) upserts.push({ label: "블로그 키워드 순위", count: parseInt(rankM[1], 10) });

  const placeRankM = /Supabase\s+플레이스\s+업서트\s+완료:\s*(\d+)건/.exec(output);
  if (placeRankM) upserts.push({ label: "플레이스 키워드 순위", count: parseInt(placeRankM[1], 10) });

  const searchadM = /SearchAd\s+전체\s+처리\s+완료:\s*total_upsert_rows=(\d+)/.exec(output);
  if (searchadM) upserts.push({ label: "SearchAd 광고 성과", count: parseInt(searchadM[1], 10) });

  return { steps, upserts };
}

function spawnAndCapture(scriptPath, args) {
  return new Promise((resolve) => {
    const chunks = [];
    const env = {
      ...process.env,
      COLLECT_ALL_NO_FILE_LOG: "1",
      PYTHONUTF8: "1",
      PYTHONIOENCODING: "utf-8",
    };
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: ROOT_DIR,
      shell: false,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (c) => chunks.push(c));
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (c) => chunks.push(c));
    child.on("error", (err) => {
      chunks.push(`[spawn 오류] ${err.message}\n`);
      resolve({ code: 1, output: chunks.join("") });
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, output: chunks.join("") });
    });
  });
}

async function pollAndRun() {
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

  console.log(`[collect-worker] Job 시작: ${job.id} | hospital_id=${job.hospital_id ?? "전체"}`);

  const isBatch = !job.hospital_id;
  const scriptName = isBatch ? "collect-all-batch.js" : "collect-all.js";
  const scriptPath = path.join(ROOT_DIR, "scripts", scriptName);
  const args = isBatch ? [] : [job.hospital_id];

  const { code, output } = await spawnAndCapture(scriptPath, args);
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

  console.log(`[collect-worker] Job ${status}: ${job.id}`);
}

console.log(`[collect-worker] 시작 — Supabase 폴링 간격: ${POLL_INTERVAL_MS / 1000}초`);

void pollAndRun();
setInterval(() => void pollAndRun(), POLL_INTERVAL_MS);
