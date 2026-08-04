/**
 * 디버그 Chrome 을 **필요할 때만 띄우고 끝나면 닫는다.**
 *
 * 왜 필요한가: 병원마다 로그인 크롬(7000~)을 하나씩 두고 워커에 **전부 상시 띄워** 두었다.
 * 12개가 아무 일도 안 하면서 메모리를 붙들고 있으니, 정작 키워드 순위 수집(9223)이 돌 때
 * 메모리가 모자라 크롬이 죽는다 — 크래시 덤프가 전부 CHROME_OUT_OF_MEMORY 였고,
 * 워커 화면의 크롬에도 "out of memory" 가 떠 있었다.
 *
 * 로그인은 프로필 폴더(user-data-dir)에 저장되므로 **닫았다 다시 열어도 유지된다.**
 * 프로세스가 아니라 디스크에 있다.
 *
 * 사용법:
 *   node scripts/manage-chrome.js ensure --port 7001     # 안 떠 있으면 띄우고, 응답할 때까지 대기
 *   node scripts/manage-chrome.js close  --port 7001     # 그 포트 크롬만 닫는다
 *   node scripts/manage-chrome.js close-hospitals        # 병원용(7000~7099) 전부 닫는다. 순위 포트·기본 포트는 안 건드림
 *   node scripts/manage-chrome.js list                   # 지금 떠 있는 디버그 크롬
 */
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const WIN_DIR = path.join(__dirname, "windows");
/** 순위 전용(9223)과 로그인 폴백(9222)은 이 스크립트의 일괄 종료 대상에서 제외한다. */
const PROTECTED_PORTS = new Set([9222, 9223]);
/** 병원용으로 보는 포트 범위. 이 밖의 포트는 close-hospitals 로 닫지 않는다. */
const HOSPITAL_PORT_MIN = 7000;
const HOSPITAL_PORT_MAX = 7099;

const READY_TIMEOUT_MS = Number(process.env.CHROME_READY_TIMEOUT_MS || "20000");
const READY_POLL_MS = 400;
/** 병원별 프로필이 사는 곳. 폴더 이름은 병원 id 다(기존 .cmd 들과 같은 규칙). */
const PROFILE_ROOT = process.env.CHROME_PROFILE_ROOT || "C:/Projects/chrome-profiles";
/** 정상 종료를 기다리는 시간. 이 안에 안 끝나면 강제 종료. */
const GRACEFUL_CLOSE_MS = Number(process.env.CHROME_GRACEFUL_CLOSE_MS || "5000");

function log(msg) {
  console.log(`[chrome] ${msg}`);
}

/** 그 포트의 Chrome 이 CDP 로 응답하는가. */
async function isUp(port) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: ctrl.signal });
      return res.ok;
    } finally {
      clearTimeout(t);
    }
  } catch {
    return false;
  }
}

/** scripts/windows 에서 이 포트를 띄우는 .cmd 를 찾는다(파일명에 port<N> 이 들어 있다). */
function launchCmdFor(port) {
  if (!fs.existsSync(WIN_DIR)) return null;
  const hit = fs
    .readdirSync(WIN_DIR)
    .filter((f) => f.toLowerCase().endsWith(".cmd"))
    .find((f) => new RegExp(`port${port}\\b`, "i").test(f));
  return hit ? path.join(WIN_DIR, hit) : null;
}

/** 이 포트로 실행 중인 chrome.exe PID 들. 커맨드라인의 --remote-debugging-port 로만 판별한다. */
function pidsOn(port) {
  const ps = [
    `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'"`,
    `| Where-Object { $_.CommandLine -like '*--remote-debugging-port=${port}*' }`,
    `| ForEach-Object { $_.ProcessId }`,
  ].join(" ");
  const res = spawnSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8" });
  return String(res.stdout || "")
    .split(/\r?\n/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/** 설치된 chrome.exe 경로. 기존 .cmd 들과 같은 순서로 찾는다. */
function chromeExe() {
  const cands = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  ].filter(Boolean);
  return cands.find((c) => fs.existsSync(c)) || null;
}

async function ensure(port, profileDir) {
  if (await isUp(port)) {
    log(`포트 ${port} 이미 떠 있음`);
    return true;
  }

  // ① 전용 .cmd 가 있으면 그걸 쓴다(기존 병원 3곳 — 특별한 플래그가 들어 있을 수 있어 존중).
  const cmd = launchCmdFor(port);
  let child;
  if (cmd) {
    log(`포트 ${port} 띄우는 중 — ${path.basename(cmd)}`);
    // cmd 안에서 start 로 띄우므로 이 프로세스는 바로 끝난다 → detached 로 두고 붙잡지 않는다.
    child = spawn("cmd.exe", ["/c", cmd], { detached: true, stdio: "ignore", windowsHide: true });
  } else {
    // ② .cmd 가 없으면 포트+프로필로 직접 띄운다. 병원마다 .cmd 를 만들어 두는 방식은
    //    13개 중 3개만 있었고 나머지는 손으로 띄워야 했다 — 그래서 자동화가 거기서 끊겼다.
    const profile = profileDir || path.join(PROFILE_ROOT, String(port));
    const exe = chromeExe();
    if (!exe) {
      log("chrome.exe 를 찾지 못함 (CHROME_PATH 로 지정 가능)");
      return false;
    }
    const isNew = !fs.existsSync(profile);
    if (isNew) {
      fs.mkdirSync(profile, { recursive: true });
      log(`프로필을 새로 만들었다 — ${profile}`);
      log("  ↳ 로그인이 안 된 빈 프로필이다. 이 창에서 한 번 로그인해야 수집이 된다.");
    }
    log(`포트 ${port} 띄우는 중 — 프로필 ${profile}`);
    child = spawn(exe, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`], {
      detached: true,
      stdio: "ignore",
      windowsHide: false, // 로그인이 필요할 수 있어 창을 숨기지 않는다
    });
  }
  child.unref();

  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, READY_POLL_MS));
    if (await isUp(port)) {
      log(`포트 ${port} 준비됨`);
      return true;
    }
  }
  log(`포트 ${port} 가 ${READY_TIMEOUT_MS / 1000}초 안에 응답하지 않음`);
  return false;
}

function close(port, { force = false } = {}) {
  if (!force && PROTECTED_PORTS.has(Number(port))) {
    log(`포트 ${port} 은 보호 대상(순위·기본) — 닫지 않음`);
    return 0;
  }
  const pids = pidsOn(port);
  if (pids.length === 0) {
    log(`포트 ${port} 떠 있지 않음`);
    return 0;
  }
  // ★ 먼저 **정상 종료**를 시도한다. /F 로 바로 죽이면 크롬이 쿠키·세션을 디스크에 쓰지 못하고
  //   끝나서 로그인이 풀릴 수 있다. 이 크롬들은 병원 네이버 계정으로 로그인해 둔 것이라
   //   세션이 날아가면 사람이 다시 로그인해야 한다.
  for (const pid of pids) {
    spawnSync("taskkill", ["/PID", String(pid)], { stdio: "ignore" }); // /F 없음 = 창 닫기 요청
  }
  // 쿠키 flush 시간을 준 뒤, 그래도 남아 있으면 그때 강제 종료한다.
  const waitUntil = Date.now() + GRACEFUL_CLOSE_MS;
  while (Date.now() < waitUntil && pidsOn(port).length > 0) {
    spawnSync(process.execPath, ["-e", "setTimeout(()=>{},300)"], { stdio: "ignore" });
  }
  const left = pidsOn(port);
  if (left.length > 0) {
    for (const pid of left) spawnSync("taskkill", ["/F", "/T", "/PID", String(pid)], { stdio: "ignore" });
    log(`포트 ${port} 닫음 (정상 종료 ${pids.length - left.length}개 · 강제 ${left.length}개)`);
  } else {
    log(`포트 ${port} 정상 종료 (${pids.length}개)`);
  }
  return pids.length;
}

/** scripts/windows 의 .cmd 파일명에서 병원용 포트를 모은다. */
function hospitalPorts() {
  if (!fs.existsSync(WIN_DIR)) return [];
  const ports = new Set();
  for (const f of fs.readdirSync(WIN_DIR)) {
    const m = /port(\d{4,5})\b/i.exec(f);
    if (!m) continue;
    const p = Number(m[1]);
    if (p >= HOSPITAL_PORT_MIN && p <= HOSPITAL_PORT_MAX && !PROTECTED_PORTS.has(p)) ports.add(p);
  }
  return [...ports].sort((a, b) => a - b);
}

async function main() {
  const [mode] = process.argv.slice(2);
  const portArgIdx = process.argv.indexOf("--port");
  const port = portArgIdx >= 0 ? Number(process.argv[portArgIdx + 1]) : null;

  if (mode === "ensure") {
    if (!port) throw new Error("--port 가 필요합니다");
    const pi = process.argv.indexOf("--profile");
    const profile = pi >= 0 ? process.argv[pi + 1] : null;
    process.exit((await ensure(port, profile)) ? 0 : 1);
  }
  if (mode === "close") {
    if (!port) throw new Error("--port 가 필요합니다");
    close(port);
    process.exit(0);
  }
  if (mode === "close-hospitals") {
    const ports = hospitalPorts();
    if (ports.length === 0) {
      log("병원용 포트를 찾지 못함 (scripts/windows/*.cmd)");
      process.exit(0);
    }
    let n = 0;
    for (const p of ports) n += close(p);
    log(`병원용 Chrome 정리 완료 — 포트 ${ports.join(", ")} / 프로세스 ${n}개`);
    process.exit(0);
  }
  // 순위 수집 직전용: 병원 로그인 Chrome 을 전부 닫고(메모리 확보) 순위 전용 Chrome 을 새로 띄운다.
  // 두 단계를 한 번에 하는 이유는 collect-all 의 prepare 가 명령 하나만 받기 때문이다.
  if (mode === "prepare-rank") {
    const ports = hospitalPorts();
    let n = 0;
    for (const p of ports) n += close(p);
    log(`병원 Chrome 정리 — 포트 ${ports.join(", ") || "-"} / 프로세스 ${n}개`);

    // 순위 전용 Chrome 재시작은 기존 스크립트를 그대로 쓴다(포트+프로필 일치분만 죽이고 띄운다).
    const restart = path.join(__dirname, "restart-rank-chrome.js");
    if (!fs.existsSync(restart)) {
      log(`순위 Chrome 재시작 스크립트 없음 — ${restart}`);
      process.exit(1);
    }
    const res = spawnSync(process.execPath, [restart], { stdio: "inherit" });
    process.exit(res.status === 0 ? 0 : 1);
  }

  if (mode === "list") {
    for (const p of [...hospitalPorts(), ...PROTECTED_PORTS]) {
      const pids = pidsOn(p);
      log(`포트 ${p}: ${pids.length ? `${pids.length}개 (${pids.join(",")})` : "없음"}`);
    }
    process.exit(0);
  }
  console.error("사용법: ensure --port N | close --port N | close-hospitals | prepare-rank | list");
  process.exit(2);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`[chrome] 실패: ${e.message}`);
    process.exit(1);
  });
}

module.exports = { isUp, launchCmdFor, hospitalPorts, chromeExe, PROFILE_ROOT, PROTECTED_PORTS, HOSPITAL_PORT_MIN, HOSPITAL_PORT_MAX };
