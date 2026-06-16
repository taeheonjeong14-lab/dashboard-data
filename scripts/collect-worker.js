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
// running 상태인데 이 시간 이상 updated_at 갱신이 없으면 워커가 죽은 고아 잡으로 보고 failed 처리.
// 정상 잡은 진행률을 1.5초마다 기록하므로 이 임계값을 한참 밑돈다.
const STALE_JOB_TIMEOUT_MS = 15 * 60_000;

let runningJobs = 0;
// 이 워커 프로세스가 실행 중인 잡 id — reaper가 자기 잡을 회수하지 않도록 제외한다.
const activeJobIds = new Set();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { db: { schema: "analytics" } }
);

function mmdd(ymd) {
  return ymd ? ymd.slice(5) : "";
}

// fetch 실패 진단용 — "TypeError: fetch failed"만으론 원인을 알 수 없어 .cause 체인을
// 풀어서(ETIMEDOUT/ECONNRESET/ENOTFOUND/EADDRINUSE/ENOBUFS 등) 함께 보여준다.
function describeError(err) {
  if (!err) return "(no error)";
  const parts = [String(err.message ?? err)];
  if (err.code) parts.push(`code=${err.code}`);
  if (err.details) parts.push(`details=${err.details}`);
  let cause = err.cause;
  let depth = 0;
  while (cause && depth < 4) {
    const code = cause.code || cause.errno;
    parts.push(`cause=${code ? code + " " : ""}${cause.message ?? cause}`);
    cause = cause.cause;
    depth += 1;
  }
  return parts.join(" | ");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 잡 행 업데이트를 네트워크 오류(DNS ENOTFOUND 등)에 대비해 백오프 재시도한다.
// supabase-js는 네트워크 실패를 throw가 아니라 { error }로 돌려주므로 그것도 처리.
async function updateJobWithRetry(fields, jobId, attempts = 4) {
  let lastErr = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const { error } = await supabase.from("collect_jobs").update(fields).eq("id", jobId);
      if (!error) return null;
      lastErr = error;
    } catch (e) {
      lastErr = e;
    }
    if (attempt < attempts - 1) await sleep(Math.min(2 ** attempt, 8) * 1000);
  }
  return lastErr;
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

function spawnAndCapture(scriptPath, args, extraEnv, onBatchHospitalDone, onStepDone, onProgress) {
  return new Promise((resolve) => {
    const chunks = [];
    let lineBuffer = "";
    let curHospitalId = null;
    let curHospitalName = null;
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
      // 단계별 진행률 마커: __PROGRESS__ {"step":"...","done":N,"total":M,"label":"..."}
      const progIdx = line.indexOf("__PROGRESS__ ");
      if (progIdx >= 0 && onProgress) {
        try {
          const marker = JSON.parse(line.slice(progIdx + "__PROGRESS__ ".length));
          if (marker && typeof marker.step === "string") {
            onProgress({
              step: marker.step,
              done: Number(marker.done) || 0,
              total: Number(marker.total) || 0,
              label: typeof marker.label === "string" ? marker.label : null,
              hospitalId: marker.hospital_id || curHospitalId,
            });
          }
        } catch { /* 파싱 실패 무시 */ }
        return;
      }

      // 배치 병원 헤더에서 현재 hospital_id 추적
      const batchHeaderM = /########## \(\d+\/\d+\) hospital_id=(\S+) ##########/.exec(line);
      if (batchHeaderM) {
        curHospitalId = batchHeaderM[1];
        curHospitalName = null;
      }

      // collect-all.js 의 "병원 조회 OK" 줄에서 이름 추적
      const nameM = /병원 조회 OK.+\| name=([^|]+)/.exec(line);
      if (nameM) {
        const n = nameM[1].trim();
        curHospitalName = n && n !== "-" ? n : null;
      }

      if (onStepDone) {
        const okM = /✓\s+(\d+)\/(\d+)\s+완료\s+\(([0-9.]+)s\)\s+[—\-]\s+(.+)/.exec(line);
        if (okM) {
          onStepDone({
            index: parseInt(okM[1], 10),
            total: parseInt(okM[2], 10),
            durationSec: parseFloat(okM[3]),
            name: okM[4].trim(),
            hospitalId: curHospitalId,
            hospitalName: curHospitalName,
          });
        }
        const failM = /✗\s+(\d+)\/(\d+)\s+실패\s+\(([0-9.]+)s\)\s+[—\-]\s+(.+)/.exec(line);
        if (failM) {
          const raw = failM[4].trim();
          const colonIdx = raw.indexOf(":");
          const name = colonIdx > 0 ? raw.slice(0, colonIdx).trim() : raw;
          const error = colonIdx > 0 ? raw.slice(colonIdx + 1).trim() : "";
          onStepDone({
            index: parseInt(failM[1], 10),
            total: parseInt(failM[2], 10),
            durationSec: parseFloat(failM[3]),
            name,
            error,
            hospitalId: curHospitalId,
            hospitalName: curHospitalName,
          });
        }
      }

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

async function reapStaleJobs() {
  const cutoff = new Date(Date.now() - STALE_JOB_TIMEOUT_MS).toISOString();
  let select = supabase
    .from("collect_jobs")
    .select("id, updated_at")
    .eq("status", "running")
    .lt("updated_at", cutoff);

  // 이 워커가 실행 중인 잡은 제외(긴 단계로 progress가 잠시 멎어도 회수하지 않도록).
  if (activeJobIds.size > 0) {
    select = select.not("id", "in", `(${[...activeJobIds].join(",")})`);
  }

  const { data: stale, error: selErr } = await select;
  if (selErr) {
    console.error("[collect-worker] reaper 조회 오류:", describeError(selErr));
    return;
  }
  if (!stale || stale.length === 0) return;

  const now = new Date().toISOString();
  for (const row of stale) {
    // finished_at은 '마지막 생존 신호(updated_at)'로 잡아 수집 시간이 부풀지 않게 한다.
    const { error: updErr } = await supabase
      .from("collect_jobs")
      .update({
        status: "failed",
        finished_at: row.updated_at,
        updated_at: now,
        output: `[reaper] ${STALE_JOB_TIMEOUT_MS / 60_000}분 이상 진행이 없어 워커 중단(고아 잡)으로 판단 — 자동 failed 처리`,
      })
      .eq("id", row.id)
      .eq("status", "running");
    if (updErr) console.error(`[collect-worker] reaper 업데이트 오류(${row.id}):`, updErr.message);
  }
  console.warn(`[collect-worker] 고아 잡 ${stale.length}건 failed 처리: ${stale.map((r) => r.id).join(", ")}`);
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
  activeJobIds.add(job.id);
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
  // SearchAd 사용자 지정 기간: 둘 다 있으면 python이 증분/청크 없이 이 구간만 수집.
  if (job.searchad_start_date && job.searchad_end_date) {
    extraEnv.SEARCHAD_METRIC_START = String(job.searchad_start_date).slice(0, 10);
    extraEnv.SEARCHAD_METRIC_END = String(job.searchad_end_date).slice(0, 10);
  }
  // SearchAd 선택 캠페인: 지정돼 있으면 그 campaign_id만 수집(쉼표 구분 env).
  if (Array.isArray(job.searchad_campaign_ids) && job.searchad_campaign_ids.length > 0) {
    extraEnv.SEARCHAD_CAMPAIGN_IDS = job.searchad_campaign_ids
      .map((c) => String(c).trim())
      .filter(Boolean)
      .join(",");
  }
  const accSteps = [];
  const onStepDone = (step) => {
    accSteps.push(step);
    const snapshot = [...accSteps];
    supabase
      .from("collect_jobs")
      .update({ steps: snapshot, updated_at: new Date().toISOString() })
      .eq("id", job.id)
      .then(() => {})
      .catch(() => {});
  };

  // 단계별 진행률: 마커 받을 때마다 누적, DB는 1.5초에 한 번만 throttle 저장.
  const progressMap = {};
  let lastProgressWrite = 0;
  let progressDirty = false;
  let progressWriteErrorLogged = false; // 진단: 진행률 저장이 '처음' 실패한 시각을 한 번만 남긴다.
  const flushProgress = () => {
    progressDirty = false;
    lastProgressWrite = Date.now();
    supabase
      .from("collect_jobs")
      .update({ progress: { ...progressMap }, updated_at: new Date().toISOString() })
      .eq("id", job.id)
      .then(({ error }) => {
        if (error && !progressWriteErrorLogged) {
          progressWriteErrorLogged = true;
          console.error(
            `[collect-worker] ⚠️ 진행률 저장 첫 실패 @ ${new Date().toISOString()} (job ${job.id}): ${describeError(error)}`,
          );
        }
      })
      .catch((e) => {
        if (!progressWriteErrorLogged) {
          progressWriteErrorLogged = true;
          console.error(
            `[collect-worker] ⚠️ 진행률 저장 첫 실패(throw) @ ${new Date().toISOString()} (job ${job.id}): ${describeError(e)}`,
          );
        }
      });
  };
  const onProgress = (p) => {
    progressMap[p.step] = {
      done: p.done,
      total: p.total,
      label: p.label,
      hospitalId: p.hospitalId ?? null,
      updatedAt: new Date().toISOString(),
    };
    progressDirty = true;
    if (Date.now() - lastProgressWrite >= 1500) flushProgress();
  };
  const progressTimer = setInterval(() => {
    // 진행 마커가 갱신됐으면 즉시 저장. 마커가 없어도(긴 하루 처리 중) 30초마다 updated_at을
    // 갱신하는 하트비트를 보내, 워커가 죽으면 admin-ui가 updated_at 정체로 중단을 감지할 수 있게 한다.
    if (progressDirty || Date.now() - lastProgressWrite >= 30_000) flushProgress();
  }, 1500);

  try {
    const { code, output } = await spawnAndCapture(scriptPath, args, extraEnv, onBatchHospitalDone, onStepDone, onProgress);
    clearInterval(progressTimer);
    const parsed = parseCollectOutput(output);
    // accSteps에는 hospitalId/hospitalName이 포함되어 있으므로 우선 사용
    const finalSteps = accSteps.length > 0 ? accSteps : parsed.steps;
    const status = code === 0 ? "done" : "failed";

    // Postgres text/jsonb는 NUL(\u0000)을 저장하지 못한다. 자식 출력(특히 Windows의 Chrome/python)에
    // NUL이 섞이면 update가 통째로 거부돼 행이 running으로 박힌다 → 미리 제거.
    const safeOutput = typeof output === "string" ? output.replace(/\u0000/g, "") : output;
    const finishedAt = new Date().toISOString();

    const finalErr = await updateJobWithRetry(
      {
        status,
        output: safeOutput,
        steps: finalSteps,
        upserts: parsed.upserts,
        finished_at: finishedAt,
        updated_at: finishedAt,
      },
      job.id,
    );

    if (finalErr) {
      console.error(`[collect-worker] 최종 상태(${status}) 저장 실패(재시도 소진): ${job.id} — ${describeError(finalErr)}`);
      console.error("[collect-worker] 최종 저장 실패 원본 에러:", finalErr);
      // 상세 필드(output·steps·upserts) 없이 상태만이라도 확정해 행이 running으로 박히지 않게 한다.
      const fbErr = await updateJobWithRetry(
        {
          status,
          finished_at: finishedAt,
          updated_at: finishedAt,
          output: `[저장 폴백] 상세 결과 저장 실패: ${describeError(finalErr)}`,
        },
        job.id,
      );
      if (fbErr) {
        console.error(`[collect-worker] 폴백 저장도 실패: ${job.id} — ${describeError(fbErr)}. reaper가 ${STALE_JOB_TIMEOUT_MS / 60_000}분 후 회수합니다.`);
      } else {
        console.warn(`[collect-worker] 상태만 저장(폴백): ${job.id} = ${status} (상세 결과는 누락)`);
      }
    } else {
      console.log(`[collect-worker] Job ${status}: ${job.id} (동시 실행: ${runningJobs - 1}/${MAX_CONCURRENT_JOBS})`);
    }
  } finally {
    clearInterval(progressTimer);
    runningJobs--;
    activeJobIds.delete(job.id);
  }
}

// ───────────────────────── 알림톡 발송 대기열(outbox) 처리 ─────────────────────────
// chart-api 가 health_report.alimtalk_outbox 에 적은 발송 건을, 이 워커(사무실 고정 IP)에서 꺼내 알리고로 보낸다.
// 알리고가 보는 발신 IP = 이 PC 의 공인 IP(사무실 고정 IP) → 알리고엔 그 IP 만 등록하면 됨.
const ALIMTALK_POLL_INTERVAL_MS = 7_000;
const ALIGO_ALIMTALK_URL = "https://kakaoapi.aligo.in/akv10/alimtalk/send/";
const TOKEN_VALUE_USD = Number(process.env.BILLING_TOKEN_VALUE_USD) || 0.001; // 1토큰=$0.001 (chart-api 와 동일)
let alimtalkBusy = false;

function aligoButtonsToJson(buttons) {
  const arr = Array.isArray(buttons) ? buttons : [];
  return JSON.stringify({
    button: arr.map((b) =>
      b && b.type === "AC"
        ? { name: b.name, linkType: "AC", linkTypeName: "채널 추가" }
        : { name: b.name, linkType: "WL", linkTypeName: "웹링크", linkMo: b.linkMo, linkPc: b.linkPc || b.linkMo }
    ),
  });
}

async function sendOneAlimtalk(row) {
  const apikey = process.env.ALIGO_API_KEY;
  const userid = process.env.ALIGO_USER_ID;
  const senderkey = process.env.ALIGO_SENDER_KEY;
  const sender = process.env.ALIGO_SENDER;
  if (!apikey || !userid || !senderkey || !sender) {
    return { ok: false, code: -1, message: "워커에 ALIGO_* 환경변수가 없습니다(.env 확인)" };
  }
  const form = new URLSearchParams();
  form.set("apikey", apikey);
  form.set("userid", userid);
  form.set("senderkey", senderkey);
  form.set("tpl_code", row.template_code);
  form.set("sender", sender);
  form.set("receiver_1", row.receiver);
  form.set("subject_1", row.subject || "건강검진 결과 리포트");
  form.set("message_1", row.message);
  if (row.emphasis_title) form.set("emtitle_1", row.emphasis_title);
  if (row.buttons) form.set("button_1", aligoButtonsToJson(row.buttons));
  if ((process.env.ALIGO_TEST_MODE || "").toLowerCase() === "y") form.set("testMode", "Y");

  const res = await fetch(ALIGO_ALIMTALK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const raw = await res.json().catch(() => ({}));
  const code = Number(raw && raw.code);
  return {
    ok: code === 0,
    code: Number.isFinite(code) ? code : -1,
    message: String((raw && raw.message) || ""),
    info: (raw && raw.info) || null, // { unitCost, totalCost } (원)
  };
}

async function processAlimtalkOutbox() {
  if (alimtalkBusy) return;
  alimtalkBusy = true;
  try {
    const { data: rows, error } = await supabase
      .schema("health_report")
      .from("alimtalk_outbox")
      .select("id, hospital_id, run_id, receiver, template_code, subject, emphasis_title, message, buttons, attempts")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(5);
    if (error) return; // 네트워크 등 — 다음 틱에 재시도
    for (const row of rows || []) {
      // 동시 중복 발송 방지: queued → sending 으로 선점한 행만 처리
      const { data: claimed } = await supabase
        .schema("health_report")
        .from("alimtalk_outbox")
        .update({ status: "sending", attempts: (row.attempts || 0) + 1, updated_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("status", "queued")
        .select("id");
      if (!claimed || claimed.length === 0) continue;
      let result;
      try {
        result = await sendOneAlimtalk(row);
      } catch (e) {
        result = { ok: false, code: -1, message: describeError(e), info: null };
      }

      // 발송 응답의 비용(원) 파싱
      let unitCost = null;
      let totalCost = null;
      if (result.ok && result.info) {
        const u = Number(result.info.unitCost);
        const t = Number(result.info.totalCost);
        unitCost = Number.isFinite(u) ? u : null;
        totalCost = Number.isFinite(t) ? t : unitCost;
      }

      // 비용 → 토큰 차감(1원=1토큰), 건강검진 리포트 run 에 귀속. best-effort.
      if (result.ok && row.hospital_id && totalCost != null && totalCost > 0) {
        const { error: chargeErr } = await supabase.schema("core").rpc("charge_alimtalk_cost", {
          p_hospital_id: row.hospital_id,
          p_operation_id: row.id,
          p_cost_krw: totalCost,
          p_run_id: row.run_id || null,
          p_token_value_usd: TOKEN_VALUE_USD,
        });
        if (chargeErr) console.warn("[collect-worker] 알림톡 비용 과금 실패(무시):", chargeErr.message);
      }

      await supabase
        .schema("health_report")
        .from("alimtalk_outbox")
        .update({
          status: result.ok ? "sent" : "failed",
          result_code: result.code,
          error: result.ok ? null : result.message,
          unit_cost: unitCost,
          total_cost: totalCost,
          sent_at: result.ok ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      console.log(
        `[collect-worker] 알림톡 ${result.ok ? "발송" : "실패"}: ${row.id} (code=${result.code}` +
          `${totalCost != null ? `, ${totalCost}원` : ""}${result.ok ? "" : " " + result.message})`
      );
    }
  } catch (e) {
    console.error("[collect-worker] 알림톡 outbox 처리 오류:", describeError(e));
  } finally {
    alimtalkBusy = false;
  }
}

console.log(`[collect-worker] 시작 — Supabase 폴링 간격: ${POLL_INTERVAL_MS / 1000}초 · 고아 잡 임계값: ${STALE_JOB_TIMEOUT_MS / 60_000}분 · 알림톡 폴링: ${ALIMTALK_POLL_INTERVAL_MS / 1000}초`);

void reapStaleJobs();
void pollAndRun();
setInterval(() => {
  void reapStaleJobs();
  void pollAndRun();
}, POLL_INTERVAL_MS);

void processAlimtalkOutbox();
setInterval(() => {
  void processAlimtalkOutbox();
}, ALIMTALK_POLL_INTERVAL_MS);
