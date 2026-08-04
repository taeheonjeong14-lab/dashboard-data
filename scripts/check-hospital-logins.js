/**
 * 병원별 로그인 Chrome 세션 점검
 *
 * 왜 필요한가: 수집 스크립트는 로그인이 끊겨도 **빈 표를 읽고 "데이터 없음"으로 조용히 끝난다.**
 * 그래서 뉴엘동물의료센터는 5월부터 두 달 넘게 아무도 모르게 비어 있었다. 수집을 돌려보기 전에
 * "이 병원 프로필이 지금 네이버에 로그인돼 있나"만 먼저 확인할 수 있어야 한다.
 *
 * 하는 일: 병원마다 (1) 그 병원 포트/프로필로 Chrome 을 띄우고 (2) 블로그 관리자·스마트플레이스
 * 통계 페이지를 열어 (3) 로그인 화면으로 튀는지 본다. 수집은 하지 않는다(DB 쓰기 없음).
 *
 * 사용법:
 *   node scripts/check-hospital-logins.js                 # 전 병원 점검
 *   node scripts/check-hospital-logins.js 뉴엘            # 이름/ID 일부로 필터
 *   node scripts/check-hospital-logins.js --close-all     # 로그인 필요한 창도 닫는다(점검만)
 *
 * 로그인이 필요한 병원의 Chrome 창은 **열어둔 채로 끝난다.** 그 창에서 바로 로그인하면 된다:
 *   1) "로그인 상태 유지" 체크하고 로그인
 *   2) 설정 → 시작 그룹 → "중단한 위치에서 계속하기" 켜기 (닫을 때 세션 쿠키가 날아가는 것 방지)
 *   3) 창을 X 로 정상 종료 (강제 종료하면 쿠키가 디스크에 안 써진다)
 */

const puppeteer = require("puppeteer-core");
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });

const ROOT_DIR = path.resolve(__dirname, "..");
const PROFILE_ROOT = process.env.CHROME_PROFILE_ROOT || "C:/Projects/chrome-profiles";
const ADMIN_BASE = "https://admin.blog.naver.com";
/** 통계 표의 날짜 행(2026.08.03. (월)  1234). collect-blog-metrics.js 의 파서와 같은 모양. */
const DATE_ROW_RE = /(\d{4})\.(\d{2})\.(\d{2})\.\s*\([^)]+\)[\t\s]+(\d+)/;

const args = process.argv.slice(2);
const CLOSE_ALL = args.includes("--close-all");
const FILTER = args.filter((a) => !a.startsWith("--"))[0] || "";

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "config.json"), "utf8"));
  } catch {
    return {};
  }
}

/** collect-all.js 의 pickPort 와 같은 우선순위: config 단계별 객체 > DB debug_port > config 단일/기본. */
function pickPort(config, hospital, kind) {
  const byHospital = config?.hospitalPorts?.[hospital.id];
  if (byHospital && typeof byHospital === "object") {
    const n = Number(byHospital[kind] != null ? byHospital[kind] : byHospital.default);
    if (Number.isFinite(n) && n > 0) return n;
  }
  if (Number.isFinite(hospital.debugPort) && hospital.debugPort > 0) return hospital.debugPort;
  const n = Number(byHospital);
  if (Number.isFinite(n) && n > 0) return n;
  const fallback = Number(config?.chrome?.debuggingPort);
  return Number.isFinite(fallback) && fallback > 0 ? fallback : null;
}

async function fetchHospitals() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 필요합니다.");
  const endpoint =
    `${url.replace(/\/$/, "")}/rest/v1/hospitals` +
    `?select=id,name,naver_blog_id,smartplace_stat_url,debug_port&order=name`;
  const res = await fetch(endpoint, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Accept-Profile": "core" },
  });
  if (!res.ok) throw new Error(`병원 조회 실패 (${res.status}) ${await res.text()}`);
  return (await res.json()).map((r) => ({
    id: String(r.id),
    name: r.name || "-",
    blogId: r.naver_blog_id || null,
    smartplaceStatUrl: r.smartplace_stat_url || null,
    debugPort: r.debug_port == null ? null : Number(r.debug_port) || null,
  }));
}

function manageChrome(mode, port, profileDir) {
  const argv = [path.join(__dirname, "manage-chrome.js"), mode, "--port", String(port)];
  if (profileDir) argv.push("--profile", profileDir);
  const res = spawnSync(process.execPath, argv, { encoding: "utf8" });
  return { ok: res.status === 0, output: `${res.stdout || ""}${res.stderr || ""}`.trim() };
}

/**
 * 한 URL 을 열어 로그인 상태를 판정한다.
 * - nid.naver.com 으로 튀면 세션 없음(=수집이 빈손으로 끝나는 상태)
 * - expectRow 가 있으면 그 정규식이 본문에 잡혀야 OK. 안 잡히면 판단 보류(UNKNOWN).
 */
async function probe(browser, url, expectRow) {
  const page = await browser.newPage();
  // 네이티브 팝업(세션 만료·보안 알림)이 뜨면 페이지 JS가 얼어 evaluate 가 무한 대기한다.
  page.on("dialog", (d) => d.dismiss().catch(() => {}));
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await new Promise((r) => setTimeout(r, 4000)); // 리다이렉트·iframe 렌더 대기
    const finalUrl = page.url();
    if (/nid\.naver\.com/.test(finalUrl)) return { status: "LOGIN", detail: "로그인 화면으로 이동" };

    // 통계 표는 iframe 안에 있는 경우가 있어 전 프레임 본문을 합쳐서 본다.
    let body = "";
    for (const frame of page.frames()) {
      const t = await Promise.race([
        frame.evaluate(() => (document.body && document.body.innerText) || ""),
        new Promise((res) => setTimeout(() => res(""), 3000)),
      ]).catch(() => "");
      if (t) body += `\n${t}`;
    }
    if (/로그인이 필요|로그인 후 이용|네이버 로그인/.test(body)) {
      return { status: "LOGIN", detail: "본문에 로그인 안내" };
    }
    if (expectRow && !expectRow.test(body)) {
      return { status: "UNKNOWN", detail: `표를 못 찾음 (${finalUrl.slice(0, 60)})` };
    }
    return { status: "OK", detail: "" };
  } catch (e) {
    return { status: "ERROR", detail: (e && e.message) || String(e) };
  } finally {
    await page.close().catch(() => {});
  }
}

async function checkHospital(config, h) {
  const port = pickPort(config, h, "blog");
  const placePort = pickPort(config, h, "place");
  const profileDir = path.join(PROFILE_ROOT, h.id);
  const result = { name: h.name, port, blog: null, place: null, needsLogin: false, ports: new Set() };

  if (!port) {
    result.blog = { status: "SKIP", detail: "포트 미설정 (core.hospitals.debug_port)" };
    return result;
  }

  const ensured = manageChrome("ensure", port, profileDir);
  result.ports.add(port);
  if (!ensured.ok) {
    result.blog = { status: "ERROR", detail: `Chrome 준비 실패 — ${ensured.output.split("\n").pop()}` };
    return result;
  }

  const browser = await puppeteer.connect({
    browserURL: `http://127.0.0.1:${port}`,
    defaultViewport: null,
    protocolTimeout: 60000,
  });
  try {
    result.blog = h.blogId
      ? await probe(browser, `${ADMIN_BASE}/${h.blogId}/stat/visit_pv`, DATE_ROW_RE)
      : { status: "SKIP", detail: "naver_blog_id 없음" };
    // 플레이스가 같은 포트면 같은 브라우저로 이어서 본다(다른 포트면 아래에서 따로).
    if (h.smartplaceStatUrl && placePort === port) {
      result.place = await probe(browser, h.smartplaceStatUrl, null);
    }
  } finally {
    await browser.disconnect();
  }

  if (h.smartplaceStatUrl && placePort && placePort !== port) {
    const e2 = manageChrome("ensure", placePort, profileDir);
    result.ports.add(placePort);
    if (!e2.ok) {
      result.place = { status: "ERROR", detail: `Chrome 준비 실패(플레이스 ${placePort})` };
    } else {
      const b2 = await puppeteer.connect({
        browserURL: `http://127.0.0.1:${placePort}`,
        defaultViewport: null,
        protocolTimeout: 60000,
      });
      try {
        result.place = await probe(b2, h.smartplaceStatUrl, null);
      } finally {
        await b2.disconnect();
      }
    }
  }
  if (!result.place && !h.smartplaceStatUrl) {
    result.place = { status: "SKIP", detail: "smartplace_stat_url 없음" };
  }

  result.needsLogin = [result.blog, result.place].some((r) => r && r.status === "LOGIN");
  return result;
}

const ICON = { OK: "✅", LOGIN: "🔒", UNKNOWN: "❔", ERROR: "❌", SKIP: "–" };

async function main() {
  const config = readConfig();
  const all = await fetchHospitals();
  const targets = FILTER
    ? all.filter((h) => h.name.includes(FILTER) || h.id.startsWith(FILTER))
    : all;
  if (targets.length === 0) {
    console.log(`'${FILTER}' 에 해당하는 병원이 없습니다.`);
    return;
  }

  console.log(`병원 ${targets.length}곳 로그인 세션 점검 (수집은 하지 않습니다)\n`);
  const results = [];
  for (const h of targets) {
    process.stdout.write(`▶ ${h.name} … `);
    const r = await checkHospital(config, h).catch((e) => ({
      name: h.name,
      port: null,
      blog: { status: "ERROR", detail: (e && e.message) || String(e) },
      place: null,
      needsLogin: false,
      ports: new Set(),
    }));
    results.push(r);
    const b = r.blog || { status: "SKIP" };
    const p = r.place || { status: "SKIP" };
    console.log(`블로그 ${ICON[b.status]} ${b.status} / 플레이스 ${ICON[p.status]} ${p.status}`);
    if (b.detail) console.log(`    ↳ 블로그: ${b.detail}`);
    if (p.detail) console.log(`    ↳ 플레이스: ${p.detail}`);

    // 로그인이 필요하면 그 창을 열어둔다 — 사람이 바로 로그인할 수 있도록.
    if (!r.needsLogin || CLOSE_ALL) {
      for (const port of r.ports) manageChrome("close", port);
    }
  }

  const needLogin = results.filter((r) => r.needsLogin);
  console.log("\n────────── 요약 ──────────");
  for (const r of results) {
    const b = (r.blog || {}).status || "SKIP";
    const p = (r.place || {}).status || "SKIP";
    console.log(`${ICON[b]}${ICON[p]}  ${r.name}${r.port ? ` (포트 ${r.port})` : ""}`);
  }
  if (needLogin.length === 0) {
    console.log("\n모든 병원 세션 정상입니다.");
    return;
  }
  console.log(`\n🔒 로그인이 필요한 병원 ${needLogin.length}곳 — Chrome 창을 열어두었습니다:`);
  for (const r of needLogin) console.log(`  · ${r.name} (포트 ${r.port})`);
  console.log(
    [
      "",
      "각 창에서:",
      "  1) 네이버 로그인 — '로그인 상태 유지' 체크",
      "  2) 설정 → 시작 그룹 → '중단한 위치에서 계속하기' 켜기",
      "     (네이버 NID_SES 는 세션 쿠키라, 이 설정이 없으면 창을 닫을 때 날아갑니다)",
      "  3) 창을 X 버튼으로 정상 종료",
      "",
      "끝나면 다시 이 스크립트를 돌려 ✅ 인지 확인하고 수집을 실행하세요.",
    ].join("\n")
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
