/**
 * 네이버 로그인 세션 수집용 "사람 흉내" 유틸.
 * 고정 간격·기계적 패턴이 계정 보안체크를 부를 수 있어, 대기/휴지/마우스/스크롤을 랜덤화한다.
 *
 * 전역 조정(환경변수):
 *   LOGIN_COLLECT_DELAY_MIN_MS / LOGIN_COLLECT_DELAY_MAX_MS  — 액션 사이 기본 대기 폭
 *   LOGIN_COLLECT_REST_EVERY                                  — 평균 N액션마다 긴 휴지
 *   LOGIN_COLLECT_REST_MIN_MS / LOGIN_COLLECT_REST_MAX_MS     — 긴 휴지 폭
 *   LOGIN_COLLECT_HUMANIZE=0                                  — 마우스/스크롤 흉내 끄기
 */

function envNum(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 액션 사이 짧은 랜덤 대기. 호출부 기본 폭은 env로 덮어쓸 수 있다. */
function jitter(minMs, maxMs) {
  const lo = envNum("LOGIN_COLLECT_DELAY_MIN_MS", minMs);
  const hi = envNum("LOGIN_COLLECT_DELAY_MAX_MS", maxMs);
  const ms = Math.floor(lo + Math.random() * Math.max(0, hi - lo));
  return sleep(ms);
}

// N액션마다 긴 휴지(사람이 잠깐 딴짓하는 것 흉내). 프로세스 단위 카운터.
let _actionCount = 0;
async function maybeLongRest(label) {
  _actionCount += 1;
  const every = envNum("LOGIN_COLLECT_REST_EVERY", 12);
  // 정확히 N의 배수만 쉬면 그것도 패턴 → 배수 근처에서 확률적으로도 발화.
  const fire = _actionCount % every === 0 || Math.random() < 1 / (every * 2);
  if (!fire) return false;
  const lo = envNum("LOGIN_COLLECT_REST_MIN_MS", 8000);
  const hi = envNum("LOGIN_COLLECT_REST_MAX_MS", 20000);
  const ms = Math.floor(lo + Math.random() * Math.max(0, hi - lo));
  if (label) console.log("⏸️  잠시 쉬는 중... (%ds, %s)", Math.round(ms / 1000), label);
  await sleep(ms);
  return true;
}

/** 페이지에서 마우스를 몇 번 랜덤 이동 + 살짝 스크롤(사람 흉내). 실패해도 무시. */
async function humanize(page) {
  if (process.env.LOGIN_COLLECT_HUMANIZE === "0") return;
  try {
    const vw = await page
      .evaluate(() => ({ w: window.innerWidth || 1280, h: window.innerHeight || 800 }))
      .catch(() => ({ w: 1280, h: 800 }));
    const moves = 2 + Math.floor(Math.random() * 3); // 2~4회
    for (let i = 0; i < moves; i++) {
      const x = 10 + Math.floor(Math.random() * Math.max(1, vw.w - 50));
      const y = 10 + Math.floor(Math.random() * Math.max(1, vw.h - 50));
      await page.mouse.move(x, y, { steps: 5 + Math.floor(Math.random() * 10) }).catch(() => {});
      await sleep(120 + Math.random() * 380);
    }
    const scrolls = 1 + Math.floor(Math.random() * 3); // 1~3회
    for (let i = 0; i < scrolls; i++) {
      const dy = Math.floor((Math.random() - 0.3) * 500); // 위/아래 섞어서
      await page.evaluate((d) => window.scrollBy(0, d), dy).catch(() => {});
      await sleep(200 + Math.random() * 500);
    }
  } catch {
    /* 무시 */
  }
}

/** Fisher–Yates 셔플(새 배열 반환). */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

module.exports = { sleep, jitter, maybeLongRest, humanize, shuffle };
