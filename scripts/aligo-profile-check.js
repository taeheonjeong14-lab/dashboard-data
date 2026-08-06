/**
 * aligo-profile-check.js — 발신프로필(senderkey)이 알리고 계정에서 살아있는지 판별한다.
 *
 * 배경: 알림톡 발송은 2단계다. (1) 알리고 API 접수(code=0) (2) 카카오 최종 발송.
 *       outbox 의 status='sent' 는 (1)까지만 보장하므로, 프로필이 죽어 있으면
 *       접수는 통과하고 최종 발송에서 "발신 프로파일 키가 유효하지 않음"으로 실패할 수 있다.
 *       template/list 는 senderkey 로 조회하므로, 프로필이 유효하지 않으면 여기서도 거절된다.
 *
 * 검사 대상: ENV(회사 기본 채널) + health_report.hospital_kakao_channel 의 병원별 키 전부.
 *
 * 실행(워커 PC — .env 에 ALIGO_* 와 SUPABASE_* 가 있고, 알리고에 등록된 고정 IP 여야 함):
 *   node scripts/aligo-profile-check.js
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });

const TEMPLATE_LIST_URL = "https://kakaoapi.aligo.in/akv10/template/list/";

const APIKEY = process.env.ALIGO_API_KEY;
const USERID = process.env.ALIGO_USER_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const mask = (s) => (s ? `${String(s).slice(0, 6)}…${String(s).slice(-6)} (${String(s).length}자)` : "(없음)");

async function restGet(schema, pathAndQuery) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Accept-Profile": schema },
  });
  const json = await res.json().catch(() => null);
  return Array.isArray(json) ? json : [];
}

async function checkSenderKey(senderkey) {
  const form = new URLSearchParams();
  form.set("apikey", APIKEY);
  form.set("userid", USERID);
  form.set("senderkey", senderkey);
  const res = await fetch(TEMPLATE_LIST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const data = await res.json().catch(() => ({}));
  const list = (data && (data.list || data.data)) || [];
  return { code: Number(data && data.code), message: String((data && data.message) || ""), list };
}

(async () => {
  if (!APIKEY || !USERID) {
    console.error("ALIGO_API_KEY / ALIGO_USER_ID 가 .env 에 필요합니다. (워커 PC 에서 실행하세요)");
    process.exit(1);
  }

  // 검사 대상 수집: ENV 기본 키 + 병원별 키
  const targets = [];
  if (process.env.ALIGO_SENDER_KEY) targets.push({ label: "ENV(회사 기본 채널)", senderkey: process.env.ALIGO_SENDER_KEY });
  if (SUPABASE_URL && SERVICE_KEY) {
    const channels = await restGet("health_report", "hospital_kakao_channel?select=hospital_id,sender_key,sender_phone,active");
    const ids = channels.map((c) => c.hospital_id).filter(Boolean);
    const hospitals = ids.length ? await restGet("core", `hospitals?select=id,name&id=in.(${ids.join(",")})`) : [];
    const nameOf = new Map(hospitals.map((h) => [h.id, h.name]));
    for (const c of channels) {
      targets.push({
        label: `${nameOf.get(c.hospital_id) || c.hospital_id}${c.active === false ? " [비활성]" : ""}`,
        senderkey: c.sender_key,
        senderPhone: c.sender_phone,
      });
    }
  } else {
    console.warn("SUPABASE_* 가 없어 병원별 키는 건너뜁니다(ENV 키만 검사).\n");
  }

  // 같은 키를 여러 병원이 공유하므로 키 기준으로 1번만 호출한다.
  const byKey = new Map();
  for (const t of targets) {
    if (!t.senderkey) continue;
    if (!byKey.has(t.senderkey)) byKey.set(t.senderkey, []);
    byKey.get(t.senderkey).push(t.label);
  }

  for (const [senderkey, labels] of byKey) {
    const r = await checkSenderKey(senderkey);
    const ok = r.code === 0;
    console.log(`\n${ok ? "✅ 유효" : "❌ 무효"}  ${mask(senderkey)}`);
    console.log(`   사용 병원: ${labels.join(", ")}`);
    console.log(`   알리고 응답: code=${r.code} ${r.message}`);
    if (ok) {
      const codes = r.list.map((t) => `${t.templtCode || t.tpl_code}(${t.templtName || "?"}, 상태=${t.inspStatus || t.status || "?"})`);
      console.log(`   등록 템플릿 ${r.list.length}개: ${codes.join(", ") || "(없음)"}`);
    }
  }

  console.log("\n※ ❌ 가 나오면 키 값 문제가 아니라 알리고 콘솔의 발신프로필 상태 문제입니다.");
  console.log("※ ✅ 인데 실제 발송이 실패하면 템플릿(코드/본문 일치) 쪽을 보세요: node scripts/aligo-template-dump.js <코드>");
})().catch((e) => {
  console.error("실패:", e && e.message ? e.message : e);
  process.exit(1);
});
