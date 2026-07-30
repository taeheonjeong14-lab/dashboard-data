/**
 * meta-ads-probe.js — Meta(Facebook) 광고 데이터 접근 탐침 (읽기 전용)
 *
 * 목적: System User 토큰으로 어떤 광고계정에 접근되는지 + 각 계정이 실제로
 *       반환하는 광고 성과/전환(actions) 종류를 확인한다. DB에 아무것도 쓰지 않음.
 *
 * 사용법:
 *   1) 루트 .env (gitignore됨)에 추가:
 *        META_ACCESS_TOKEN=시스템유저_토큰        ← 비밀키! 코드/채팅에 직접 넣지 말 것
 *        META_AD_ACCOUNT_ID=act_1234567890       ← act_ 접두사 포함
 *        # 선택: META_API_VERSION=v22.0          ← 버전 에러 나면 올려보세요
 *   2) node scripts/meta-ads-probe.js
 *
 * 필요: Node 18+ (전역 fetch), 토큰 권한 ads_read
 */

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });

const TOKEN = (process.env.META_ACCESS_TOKEN || "").trim();
const AD_ACCOUNT = (process.env.META_AD_ACCOUNT_ID || "").trim();
const VERSION = (process.env.META_API_VERSION || "v22.0").trim();
const BASE = `https://graph.facebook.com/${VERSION}`;

function die(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

if (!TOKEN) die("META_ACCESS_TOKEN 이 .env 에 없습니다.");

async function g(pathname, params) {
  const usp = new URLSearchParams({ ...params, access_token: TOKEN });
  const res = await fetch(`${BASE}${pathname}?${usp.toString()}`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const e = json.error || {};
    throw new Error(
      `HTTP ${res.status} — ${e.message || JSON.stringify(json)} (code=${e.code ?? "?"}, type=${e.type ?? "?"})`,
    );
  }
  return json;
}

async function main() {
  console.log(`[meta-probe] Graph API ${VERSION} (읽기 전용)\n`);

  // 1) 접근 가능한 광고계정 목록 — 토큰 검증 + 무엇이 보이는지
  console.log("── 접근 가능한 광고계정 (me/adaccounts) ──");
  try {
    const accts = await g("/me/adaccounts", {
      fields: "name,account_id,account_status,currency",
      limit: "200",
    });
    const list = accts.data || [];
    if (list.length === 0) {
      console.log("  (없음 — 토큰/시스템유저에 광고계정이 할당돼 있지 않을 수 있음)");
    }
    for (const a of list) {
      console.log(`  • act_${a.account_id} | ${a.name} | status=${a.account_status} | ${a.currency}`);
    }
    console.log(`  총 ${list.length}개\n`);
  } catch (e) {
    console.error(`  계정 목록 조회 실패: ${e.message}\n`);
  }

  // 1-b) 비즈니스 포트폴리오 경유 광고계정
  //  /me/adaccounts 는 "사용자에게 직접 역할이 부여된" 계정만 돌려준다. 대행 구조에서 흔한
  //  "고객사 포트폴리오를 통해 접근하는 계정"은 여기 안 나오므로, 포트폴리오별로 따로 훑는다.
  //  (owned = 그 포트폴리오가 소유 / client = 그 포트폴리오가 고객사로부터 공유받은 것)
  console.log("── 비즈니스 포트폴리오 경유 광고계정 (me/businesses) ──");
  try {
    const biz = await g("/me/businesses", { fields: "id,name", limit: "100" });
    const list = biz.data || [];
    if (list.length === 0) console.log("  (소속된 비즈니스 포트폴리오 없음)");
    for (const b of list) {
      console.log(`  ▸ 포트폴리오: ${b.name} (id=${b.id})`);
      for (const edge of ["owned_ad_accounts", "client_ad_accounts"]) {
        try {
          const r = await g(`/${b.id}/${edge}`, {
            fields: "name,account_id,account_status,currency",
            limit: "200",
          });
          const accts = r.data || [];
          if (accts.length === 0) continue;
          console.log(`      [${edge}] ${accts.length}개`);
          for (const a of accts) {
            console.log(`        • act_${a.account_id} | ${a.name} | status=${a.account_status} | ${a.currency}`);
          }
        } catch (e) {
          console.log(`      [${edge}] 조회 실패: ${e.message}`);
        }
      }
    }
    console.log("");
  } catch (e) {
    console.error(`  포트폴리오 조회 실패: ${e.message}`);
    console.error("  → 토큰에 business_management 권한이 없으면 이 조회는 막힙니다.");
    console.error("    Graph API Explorer 에서 business_management 를 추가해 토큰을 다시 받아보세요.\n");
  }

  if (!AD_ACCOUNT) {
    console.log("META_AD_ACCOUNT_ID 가 없어 인사이트 샘플은 생략합니다. 위 목록에서 하나를 .env 에 넣고 다시 실행하세요.");
    return;
  }

  // 2) 인사이트 샘플 — 최근 30일, ad 레벨, 일별
  console.log(`── 인사이트 샘플: ${AD_ACCOUNT} (최근 30일 · ad 레벨 · 일별) ──`);
  const ins = await g(`/${AD_ACCOUNT}/insights`, {
    level: "ad",
    time_increment: "1",
    date_preset: "last_30d",
    fields: "date_start,campaign_name,adset_name,ad_name,impressions,clicks,reach,spend,actions,action_values",
    limit: "50",
  });
  const rows = ins.data || [];
  console.log(`  행 수(첫 페이지): ${rows.length}`);
  if (rows[0]) {
    const r = rows[0];
    console.log("  샘플 1행:");
    console.log(`    ${r.date_start} | ${r.campaign_name ?? "-"} > ${r.ad_name ?? "-"}`);
    console.log(`    impressions=${r.impressions ?? 0} clicks=${r.clicks ?? 0} spend=${r.spend ?? 0} reach=${r.reach ?? 0}`);
  }

  // 3) 이 계정이 실제로 반환하는 전환/액션 종류 — 병원별 스키마 확정용
  const actionTypes = new Set();
  for (const r of rows) {
    for (const a of r.actions || []) actionTypes.add(a.action_type);
  }
  console.log(`\n── 이 계정에서 발견된 전환/액션 종류 (${actionTypes.size}) ──`);
  for (const t of [...actionTypes].sort()) console.log(`  • ${t}`);
  if (actionTypes.size === 0) {
    console.log("  (최근 30일 전환 데이터 없음 — 광고 미집행이거나 해당 기간 전환 미발생)");
  }

  console.log("\n✓ 탐침 완료 (DB 변경 없음).");
}

main().catch((e) => die(e.message));
