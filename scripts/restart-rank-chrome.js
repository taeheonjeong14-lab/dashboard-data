/**
 * restart-rank-chrome.js — 순위 수집 전용 디버그 Chrome을 닫고 다시 띄운다.
 *
 * 왜 필요한가: 워커 머신을 오래 켜두면 이 Chrome이 서서히 상해서, HTTP 엔드포인트
 * (/json/version)는 응답하는데 CDP 세션만 못 여는 상태가 된다. 그러면 순위 수집이
 * 34개 조합을 하나씩 재시도하며 24분을 태우고 전멸한다(실측 7일간 22건).
 * "상했는지" 판별하려 애쓰는 대신 **매 수집 전에 새 인스턴스로 시작해** 누적 자체를 없앤다.
 *
 * 안전장치: 종료 대상을 **그 포트와 그 프로필이 커맨드라인에 둘 다 있는** chrome.exe 로만
 * 한정한다. 로그인용(7000~7012)·기본(9222) Chrome 은 건드리지 않는다. 순위는 스크래핑
 * 단계라 SCRAPE_MAX_CONCURRENT=1 이어서 동시에 도는 다른 순위 잡을 죽일 일도 없다.
 *
 * Usage: node scripts/restart-rank-chrome.js
 * env:
 *   RANK_CHROME_DEBUGGING_PORT   기본 9223
 *   RANK_CHROME_PROFILE_DIR      기본 C:\Projects\chrome-profiles\rank-nologin-9223
 *   RANK_CHROME_LAUNCH_CMD       기본 scripts/windows/chrome-debug-rank-port9223.cmd
 *   RANK_CHROME_READY_TIMEOUT_MS 기본 20000
 */

const { spawn, spawnSync } = require("child_process");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });

const ROOT_DIR = path.resolve(__dirname, "..");
const PORT = String(process.env.RANK_CHROME_DEBUGGING_PORT || "9223").trim();
const PROFILE_DIR = String(
  process.env.RANK_CHROME_PROFILE_DIR || "C:\\Projects\\chrome-profiles\\rank-nologin-9223",
).trim();
const LAUNCH_CMD = path.resolve(
  ROOT_DIR,
  process.env.RANK_CHROME_LAUNCH_CMD || path.join("scripts", "windows", `chrome-debug-rank-port${PORT}.cmd`),
);
const READY_TIMEOUT_MS = Number(process.env.RANK_CHROME_READY_TIMEOUT_MS) || 20_000;

function log(msg) {
  console.log(`[rank-chrome] ${msg}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** /json/version 이 응답하면 포트가 살아 있다. (CDP 세션까지 되는지는 파이썬이 확인한다) */
async function isDebugPortUp() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/version`, {
      signal: AbortSignal.timeout(2_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * 그 포트 + 그 프로필로 실행된 chrome.exe 만 종료한다.
 * 두 조건을 **모두** 만족해야 죽인다 — 한쪽만 보면 다른 용도의 Chrome 을 잡을 수 있다.
 */
function killRankChrome() {
  // PowerShell 단일 인용부호 안에서는 역슬래시가 이스케이프가 아니므로 경로를 그대로 쓴다.
  const script = [
    `$procs = Get-CimInstance Win32_Process -Filter "name='chrome.exe'" |`,
    `  Where-Object { $_.CommandLine -like '*--remote-debugging-port=${PORT}*'`,
    `    -and $_.CommandLine -like '*${PROFILE_DIR}*' };`,
    `if (-not $procs) { Write-Output 'NONE'; exit 0 }`,
    `foreach ($p in $procs) { try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; Write-Output $p.ProcessId } catch {} }`,
  ].join(" ");

  const res = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { encoding: "utf8", windowsHide: true },
  );
  const out = String(res.stdout || "").trim();
  if (res.error) {
    log(`종료 시도 실패(무시하고 계속): ${res.error.message}`);
    return 0;
  }
  if (!out || out === "NONE") {
    log(`기존 프로세스 없음 (포트 ${PORT}, 프로필 ${PROFILE_DIR})`);
    return 0;
  }
  const pids = out.split(/\r?\n/).map((s) => s.trim()).filter((s) => /^\d+$/.test(s));
  log(`기존 Chrome ${pids.length}개 종료: ${pids.join(", ")}`);
  return pids.length;
}

function launchRankChrome() {
  log(`실행: ${LAUNCH_CMD}`);
  // cmd 안에서 start 로 띄우므로 이 프로세스는 바로 끝난다 → detached 로 두고 붙잡지 않는다.
  const child = spawn("cmd.exe", ["/c", LAUNCH_CMD], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

async function main() {
  if (process.platform !== "win32") {
    log("Windows 전용 — 건너뜁니다.");
    return;
  }

  killRankChrome();
  // 프로필 락이 풀릴 시간을 준다. 바로 띄우면 기존 인스턴스에 핸드오프되어 포트가 안 열릴 수 있다.
  await sleep(2_000);
  launchRankChrome();

  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isDebugPortUp()) {
      log(`준비 완료 — 포트 ${PORT} 응답 확인`);
      return;
    }
    await sleep(1_000);
  }

  // 여기서 실패하면 순위 수집을 24분 태우는 대신 즉시 알린다.
  // 이 문구는 collect-all 의 실패 힌트로 잡혀 에러 로그·텔레그램에 그대로 올라간다.
  throw new Error(
    `❌ 순위 전용 디버그 Chrome(포트 ${PORT})을 ${READY_TIMEOUT_MS / 1000}초 안에 띄우지 못했습니다. ` +
      `실행 파일(${LAUNCH_CMD})과 Chrome 설치 경로를 확인하세요.`,
  );
}

main().catch((err) => {
  console.error(err && err.message ? err.message : String(err));
  process.exit(1);
});
