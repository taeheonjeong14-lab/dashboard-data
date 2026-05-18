/**
 * 원클릭 전체 수집 오케스트레이터
 *
 * Usage:
 *   node scripts/collect-all.js [hospitalId]
 *   npm run collect:all -- [hospitalId]
 *
 * 로그:
 * - 기본: 콘솔 = 진행 요약(한눈에) / 같은 실행의 `logs/collect-all-*.log` = 오케스트레이터 + 자식 stdout·stderr 전체
 * - `COLLECT_ALL_NO_FILE_LOG=1`: 파일 없음, 콘솔에 자식 출력까지 전부(이전과 유사)
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });

const ROOT_DIR = path.resolve(__dirname, "..");
const HOSPITAL_ID = (process.argv[2] || "").trim();
const STEP_TIMEOUT_MS = 60 * 60 * 1000; // 단계당 최대 60분

const STEPS_FILTER = (() => {
  const raw = process.env.COLLECT_STEPS_FILTER;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
})();

/** @type {{ phase: string; completedSteps: { index: number; name: string }[]; logFilePath: string | null }} */
const runState = { phase: "시작 전", completedSteps: [], logFilePath: null };

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatTimestamp(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(
    d.getMinutes()
  )}:${pad2(d.getSeconds())}`;
}

function fileStamp(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}_${pad2(d.getHours())}-${pad2(
    d.getMinutes()
  )}-${pad2(d.getSeconds())}`;
}

function formatTimeShort(d = new Date()) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** @type {import("fs").WriteStream | null} */
let logFileStream = null;

/**
 * 오케스트레이터 한 줄. 파일이 있으면: 파일=전체 타임스탬프, 콘솔=짧은 시각+요약.
 * 파일이 없으면: 콘솔만 전체 타임스탬프(자식 inherit과 함께 디버깅용).
 */
function emit(line, stream = "out") {
  const fileLine = `[${formatTimestamp()}] [collect:all] ${line}\n`;
  if (logFileStream) {
    logFileStream.write(fileLine);
  }
  if (logFileStream) {
    const short = `[${formatTimeShort()}] ${line}`;
    if (stream === "err") {
      console.error(short);
    } else {
      console.log(short);
    }
  } else {
    const full = `[${formatTimestamp()}] [collect:all] ${line}`;
    if (stream === "err") {
      console.error(full);
    } else {
      console.log(full);
    }
  }
}

function writeChildChunk(stepIndex, totalSteps, stepName, streamKind, buf) {
  if (!logFileStream) return;
  const ts = formatTimestamp();
  const head = `[${ts}] [자식 ${stepIndex}/${totalSteps} ${streamKind}] [${stepName}] `;
  const text = Buffer.isBuffer(buf) ? buf.toString("utf8") : String(buf);
  logFileStream.write(head);
  logFileStream.write(text.endsWith("\n") ? text : text + "\n");
}

function initFileLog(resolvedHospitalId = "") {
  if (process.env.COLLECT_ALL_NO_FILE_LOG === "1") {
    emit("파일 로그 비홨성화(COLLECT_ALL_NO_FILE_LOG=1). 콘솔만 기록합니다.");
    return null;
  }
  const logRoot = process.env.COLLECT_ALL_LOG_ROOT || "C:\\Projects\\chrome-profiles";
  const safeHospitalId = String(resolvedHospitalId || "unknown").trim() || "unknown";
  const logsDir = path.join(logRoot, safeHospitalId, "logs");
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  const filePath = path.join(logsDir, `collect-all-${fileStamp()}.log`);
  logFileStream = fs.createWriteStream(filePath, { flags: "a" });
  logFileStream.on("error", (err) => {
    console.error(`[collect:all] 로그 파일 쓰기 오류: ${err.message}`);
  });
  return filePath;
}

function closeFileLog() {
  if (logFileStream) {
    logFileStream.end();
    logFileStream = null;
  }
}

function readChromeDebugPort() {
  try {
    const raw = fs.readFileSync(path.join(ROOT_DIR, "config.json"), "utf8");
    const cfg = JSON.parse(raw);
    const port = cfg.chrome?.debuggingPort;
    return typeof port === "number" ? port : Number(port) || null;
  } catch {
    return null;
  }
}

function readConfig() {
  try {
    const raw = fs.readFileSync(path.join(ROOT_DIR, "config.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function resolveHospitalChromePort(config, hospitalId) {
  const byHospital = config?.hospitalPorts?.[hospitalId];
  const parsedHospitalPort = typeof byHospital === "number" ? byHospital : Number(byHospital);
  if (Number.isFinite(parsedHospitalPort) && parsedHospitalPort > 0) {
    return parsedHospitalPort;
  }
  const fallback = config?.chrome?.debuggingPort;
  const parsedFallback = typeof fallback === "number" ? fallback : Number(fallback);
  return Number.isFinite(parsedFallback) && parsedFallback > 0 ? parsedFallback : null;
}

async function resolveHospital(hospitalId) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 필요합니다.");
  }
  if (!hospitalId) {
    throw new Error("hospital_id를 인자로 전달해 주세요. 예: npm run collect:all -- <hospital_id>");
  }

  const endpoint = `${url.replace(/\/$/, "")}/rest/v1/hospitals?select=id,name,naver_blog_id,debug_port&id=eq.${encodeURIComponent(
    hospitalId
  )}&limit=1`;
  const res = await fetch(endpoint, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Accept-Profile": "core",
      "Content-Profile": "core",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`core.hospitals 조회 실패: status=${res.status}, body=${body.slice(0, 300)}`);
  }
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`core.hospitals에서 id=${hospitalId}를 찾을 수 없습니다.`);
  }
  const row = rows[0];
  const blogId = String(row.naver_blog_id || "").trim();
  if (!blogId) {
    throw new Error(`core.hospitals.id=${hospitalId}의 naver_blog_id가 비어 있습니다.`);
  }
  return {
    hospitalId: String(row.id),
    hospitalName: row.name || null,
    blogId,
    debugPort: row.debug_port == null ? null : Number(row.debug_port) || null,
  };
}

/**
 * @returns {Promise<{ success: boolean; durationSec: number; error?: string }>}
 */
function runStep(stepIndex, totalSteps, stepName, command, args, options = {}) {
  return new Promise((resolve) => {
    const prettyArgs = args.join(" ");
    const pipeChild = Boolean(logFileStream);
    emit(`▶ ${stepIndex}/${totalSteps} ${stepName}`);
    if (pipeChild) {
      emit(`   (상세 출력은 로그 파일의 자식 ${stepIndex}/${totalSteps} 구간 참고)`);
    }
    emit(`   실행: ${command} ${prettyArgs}`.trim());

    const stepStarted = Date.now();
    const { env: optEnv, ...restOpts } = options;

    let child;
    try {
      child = spawn(command, args, {
        cwd: ROOT_DIR,
        shell: false,
        ...restOpts,
        env: optEnv ?? process.env,
        // 항상 pipe 사용: inherit 시 Python이 직접 파이프에 써서 버퍼가 찰 경우
        // Node.js의 console.log()가 동기 블록 → 이벤트 루프 멈춤 → setTimeout 지연 발생.
        // pipe + 비동기 포워딩으로 이벤트 루프를 항상 살아있게 유지.
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (spawnErr) {
      const sec = ((Date.now() - stepStarted) / 1000).toFixed(1);
      const msg = spawnErr && spawnErr.message ? spawnErr.message : String(spawnErr);
      emit(`✗ ${stepIndex}/${totalSteps} 실패 (${sec}s) — ${stepName}: spawn 오류: ${msg}`, "err");
      resolve({ success: false, durationSec: parseFloat(sec), error: `spawn 오류: ${msg}` });
      return;
    }

    let settled = false;

    const timeoutHandle = setTimeout(() => {
      if (settled) return;
      settled = true;
      // Windows: child.kill()은 Python 자체만 종료하고 자식 프로세스(크롬 등)는 살아남음.
      // taskkill /F /T로 프로세스 트리 전체 강제 종료.
      try {
        if (process.platform === "win32" && child.pid) {
          spawn("taskkill", ["/F", "/T", "/PID", String(child.pid)], {
            shell: false, stdio: "ignore",
          }).on("error", () => {});
        } else {
          child.kill("SIGKILL");
        }
      } catch { /* 이미 종료됐을 수 있음 */ }
      const sec = ((Date.now() - stepStarted) / 1000).toFixed(1);
      const msg = `타임아웃 (${STEP_TIMEOUT_MS / 60000}분 초과)`;
      emit(`✗ ${stepIndex}/${totalSteps} 실패 (${sec}s) — ${stepName}: ${msg}`, "err");
      resolve({ success: false, durationSec: parseFloat(sec), error: msg });
    }, STEP_TIMEOUT_MS);

    // 항상 stdout/stderr를 비동기로 드레인해서 파이프 블록 방지.
    // 파일 로그 모드: 로그 파일에 기록. 콘솔 모드: 부모 stdout/stderr에 포워딩(worker 파싱용).
    if (child.stdout) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        if (pipeChild) {
          writeChildChunk(stepIndex, totalSteps, stepName, "stdout", chunk);
        } else {
          process.stdout.write(chunk);
        }
      });
    }
    if (child.stderr) {
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        if (pipeChild) {
          writeChildChunk(stepIndex, totalSteps, stepName, "stderr", chunk);
        } else {
          process.stderr.write(chunk);
        }
      });
    }

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      const sec = ((Date.now() - stepStarted) / 1000).toFixed(1);
      const msg = err && err.message ? err.message : String(err);
      emit(`✗ ${stepIndex}/${totalSteps} 실패 (${sec}s) — ${stepName}: spawn 오류: ${msg}`, "err");
      resolve({ success: false, durationSec: parseFloat(sec), error: `spawn 오류: ${msg}` });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      const sec = ((Date.now() - stepStarted) / 1000).toFixed(1);
      if (code === 0) {
        emit(`✓ ${stepIndex}/${totalSteps} 완료 (${sec}s) — ${stepName}`);
        resolve({ success: true, durationSec: parseFloat(sec) });
        return;
      }
      const tail =
        pipeChild && runState.logFilePath
          ? `로그 파일 확인: ${runState.logFilePath}`
          : "콘솔 출력을 확인하세요.";
      const msg = `종료 코드 ${code}. ${tail}`;
      emit(`✗ ${stepIndex}/${totalSteps} 실패 (${sec}s) — ${stepName}: ${msg}`, "err");
      resolve({ success: false, durationSec: parseFloat(sec), error: msg });
    });
  });
}

async function main() {
  runState.phase = "병원 조회 (Supabase core.hospitals)";
  const resolvedForLog = await resolveHospital(HOSPITAL_ID);
  runState.phase = "로그 파일 생성";
  runState.logFilePath = null;
  const logPath = initFileLog(resolvedForLog.hospitalId);
  if (logPath) {
    runState.logFilePath = logPath;
    emit(`로그 파일: ${logPath}`);
  }

  const startedAt = Date.now();
  emit("========== collect:all 시작 ==========");
  emit(`Node ${process.version} | cwd: ${ROOT_DIR}`);

  const dbg = readChromeDebugPort();
  const rankCdp = process.env.RANK_USE_DEBUG_CHROME || "";
  const rankPort = process.env.CHROME_DEBUGGING_PORT || "";
  emit(
    `실행 환경: Chrome포트(config)=${dbg == null ? "?" : dbg} | 순위CDP=${rankCdp || "끔"} | 순위포트=${rankPort || "-"}`
  );

  runState.phase = "병원 조회 (Supabase core.hospitals)";
  emit(runState.phase + " …");
  const resolved = resolvedForLog;
  emit(
    `병원 조회 OK — id=${resolved.hospitalId} | name=${resolved.hospitalName || "-"} | naver_blog_id=${resolved.blogId}`
  );
  const config = readConfig();
  const configChromePort = resolveHospitalChromePort(config, resolved.hospitalId);
  const resolvedChromePort =
    Number.isFinite(resolved.debugPort) && resolved.debugPort > 0 ? resolved.debugPort : configChromePort;
  emit(`병원별 Chrome 포트: ${resolvedChromePort == null ? "(미설정, 스크립트 기본값 사용)" : resolvedChromePort}`);

  const baseEnv = {
    ...process.env,
    COLLECT_HOSPITAL_ID: resolved.hospitalId,
    // Windows(cp949) 콘솔에서도 파이썬 stdout/stderr 유니코드 출력이 깨지지 않도록 강제 UTF-8.
    PYTHONUTF8: process.env.PYTHONUTF8 || "1",
    PYTHONIOENCODING: process.env.PYTHONIOENCODING || "utf-8",
    ...(resolvedChromePort == null
      ? {}
      : {
          COLLECT_CHROME_DEBUGGING_PORT: String(resolvedChromePort),
          CHROME_DEBUGGING_PORT: process.env.CHROME_DEBUGGING_PORT || String(resolvedChromePort),
        }),
  };

  const allSteps = [
    {
      key: "blog_metrics",
      name: "블로그 일별 지표 수집",
      command: process.execPath,
      args: [path.join(ROOT_DIR, "scripts", "collect-blog-metrics.js"), resolved.blogId],
      options: { env: baseEnv },
    },
    {
      key: "smartplace",
      name: "스마트플레이스 유입 수집",
      command: process.execPath,
      args: [path.join(ROOT_DIR, "scripts", "collect-smartplace-inflow.js"), resolved.blogId],
      options: { env: baseEnv },
    },
    {
      key: "keyword_rank",
      name: "블로그/플레이스 키워드 순위 수집",
      command: "python",
      args: [path.join(ROOT_DIR, "scripts", "naver-rank-main.py")],
      options: { env: baseEnv },
    },
    {
      key: "searchad",
      name: "SearchAd 일별 성과 수집",
      command: "python",
      args: [path.join(ROOT_DIR, "scripts", "naver-searchad-main.py")],
      options: { env: baseEnv },
    },
  ];
  const steps = STEPS_FILTER ? allSteps.filter((s) => STEPS_FILTER.includes(s.key)) : allSteps;

  emit(`총 ${steps.length}단계 수집을 순서대로 실행합니다.`);

  runState.completedSteps = [];
  const total = steps.length;
  const failedSteps = [];

  runState.phase = "수집 단계 실행";
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepIndex = i + 1;
    runState.phase = `단계 ${stepIndex}/${total}: ${step.name}`;
    const result = await runStep(stepIndex, total, step.name, step.command, step.args, step.options);
    if (result.success) {
      runState.completedSteps.push({ index: stepIndex, name: step.name });
    } else {
      failedSteps.push({ index: stepIndex, name: step.name, error: result.error });
    }
  }

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  if (failedSteps.length === 0) {
    runState.phase = "완료";
    emit(`========== collect:all 전체 완료 (${elapsedSec}s) ==========`);
    emit(`완료된 단계: ${runState.completedSteps.map((s) => `${s.index}. ${s.name}`).join(" → ")}`);
  } else {
    runState.phase = "일부 실패";
    emit(`========== collect:all 완료 (${failedSteps.length}개 단계 실패, 전체 ${elapsedSec}s) ==========`, "err");
    if (runState.completedSteps.length > 0) {
      emit(`성공한 단계: ${runState.completedSteps.map((s) => `${s.index}. ${s.name}`).join(" → ")}`);
    }
    emit(`실패한 단계: ${failedSteps.map((s) => `${s.index}. ${s.name}`).join(", ")}`, "err");
  }
  if (runState.logFilePath) {
    emit(`상세 로그(자식 출력 포함): ${runState.logFilePath}`);
  }
  closeFileLog();
  if (failedSteps.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  const msg = err && err.message ? err.message : String(err);
  emit("──────── (실패 요약 아래) ────────", "err");
  emit("========== collect:all 실패 ==========", "err");
  emit(`마지막으로 진행 중이던 구간: ${runState.phase}`, "err");
  emit(`오류 메시지: ${msg}`, "err");
  if (runState.completedSteps.length > 0) {
    emit(
      `실패 전까지 완료된 단계 (${runState.completedSteps.length}개): ${runState.completedSteps
        .map((s) => `${s.index}. ${s.name}`)
        .join(" → ")}`,
      "err"
    );
  } else {
    emit("완료된 수집 단계 없음 (병원 조회 직후이거나 그 이전에서 실패했을 수 있습니다).", "err");
  }
  if (runState.logFilePath) {
    emit(`상세 로그(자식 stdout/stderr): ${runState.logFilePath}`, "err");
  } else {
    emit(`힌트: "단계 N/M"이면 해당 스크립트가 실패한 것입니다. 위 콘솔 출력을 확인하세요.`, "err");
  }
  closeFileLog();
  process.exit(1);
});
