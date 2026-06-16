/**
 * aligo-template-dump.js — 알리고에 등록된 알림톡 템플릿 원문을 가져와
 * 본문/제목의 "숨은 문자(특수공백 NBSP, 제로폭, 탭 등)"를 찾아낸다.
 *
 * 용도: "메시지가 템플릿과 일치하지 않음" 디버깅 — 코드의 본문과 등록 템플릿이
 *       눈엔 같아 보여도 특수문자가 섞이면 매칭이 깨진다. 그 차이를 콕 집어낸다.
 *
 * 실행(워커 PC, .env 에 ALIGO_* 있어야 함):
 *   node scripts/aligo-template-dump.js          (ALIGO_TPL_CODE 사용)
 *   node scripts/aligo-template-dump.js UI_6805  (코드 직접 지정)
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });

const TPL_CODE = (process.argv[2] || process.env.ALIGO_TPL_CODE || "").trim();

const HIDDEN = {
  0x0009: "TAB",
  0x00a0: "NBSP(특수공백)",
  0x1680: "OGHAM_SPACE",
  0x2000: "EN_QUAD",
  0x2002: "EN_SPACE",
  0x2003: "EM_SPACE",
  0x2007: "FIGURE_SPACE",
  0x200b: "ZERO_WIDTH_SPACE",
  0x200c: "ZWNJ",
  0x200d: "ZWJ",
  0x202f: "NARROW_NBSP",
  0x3000: "IDEOGRAPHIC_SPACE(전각공백)",
  0xfeff: "BOM/ZWNBSP",
};

function scanHidden(label, s) {
  if (typeof s !== "string") return;
  const hits = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (HIDDEN[c]) {
      const ctx = s.slice(Math.max(0, i - 10), i).replace(/\n/g, "\\n");
      hits.push(`  pos ${i}: U+${c.toString(16).padStart(4, "0")} ${HIDDEN[c]}  ← 직전: "${ctx}"`);
    }
  }
  console.log(`\n=== [${label}] 길이 ${s.length} · 숨은문자 ${hits.length}개 ===`);
  if (hits.length) hits.forEach((h) => console.log(h));
  console.log("--- 원문(JSON 이스케이프) ---");
  console.log(JSON.stringify(s));
}

(async () => {
  const apikey = process.env.ALIGO_API_KEY;
  const userid = process.env.ALIGO_USER_ID;
  const senderkey = process.env.ALIGO_SENDER_KEY;
  if (!apikey || !userid || !senderkey) {
    console.error("ALIGO_API_KEY / ALIGO_USER_ID / ALIGO_SENDER_KEY 가 .env 에 필요합니다.");
    process.exit(1);
  }
  const form = new URLSearchParams();
  form.set("apikey", apikey);
  form.set("userid", userid);
  form.set("senderkey", senderkey);
  if (TPL_CODE) form.set("tpl_code", TPL_CODE);

  const res = await fetch("https://kakaoapi.aligo.in/akv10/template/list/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const data = await res.json().catch(() => ({}));
  console.log("HTTP", res.status, "| code:", data && data.code, "| message:", data && data.message);

  const list = (data && (data.list || data.data)) || [];
  if (!Array.isArray(list) || list.length === 0) {
    console.log("\n템플릿 목록이 비어있습니다. 전체 응답:");
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  const tpl = TPL_CODE ? list.find((t) => (t.templtCode || t.tpl_code) === TPL_CODE) || list[0] : list[0];
  console.log("\n템플릿 코드:", tpl.templtCode || tpl.tpl_code, "| 이름:", tpl.templtName);
  // 알리고 응답 필드명이 버전마다 다를 수 있어, 본문/제목 후보 키를 모두 스캔.
  const bodyKeys = ["templtContent", "templt_content", "content", "message"];
  const titleKeys = ["templtEmType", "emphasizeTitle", "templtEmphasizeTitle", "emTitle", "templtTitle", "title"];
  for (const k of bodyKeys) if (tpl[k]) scanHidden(`본문(${k})`, tpl[k]);
  for (const k of titleKeys) if (tpl[k]) scanHidden(`제목/강조(${k})`, tpl[k]);
  console.log("\n--- 템플릿 전체 객체(필드 확인용) ---");
  console.log(JSON.stringify(tpl, null, 2));
})().catch((e) => {
  console.error("실패:", e && e.message ? e.message : e);
  process.exit(1);
});
