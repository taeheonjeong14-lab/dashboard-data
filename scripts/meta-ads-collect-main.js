/**
 * meta-ads-collect-main.js — Meta(인스타그램/페이스북) 광고 일별 성과·전환 수집
 *
 * googleads-collect-main.js 와 동형(ESM + supabase-js, 워커 머신에서 실행).
 * 다른 점: 토큰이 병원별이 아니라 **공용 1개**다(대행사 한 계정이 모든 광고계정 관리자).
 *   → analytics.analytics_meta_credentials 단일 행에 저장하고, 병원 구분은 ad_account_id 로 한다.
 *
 * 토큰 무인 운영:
 *   60일 사용자 토큰은 만료 전에 교환하면 새 60일이 붙는다. 매 실행마다 남은 기간을 보고
 *   임계치 미만이면 자동 교환해 DB에 덮어쓴다 → 수집기가 60일 안에 한 번이라도 돌면 끊기지 않는다.
 *   (System User 토큰(무기한)으로 바꿔 넣으면 만료가 없어 이 로직은 자연히 건너뛴다.)
 *
 * 필요 env:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   META_APP_ID, META_APP_SECRET      ← 토큰 자동 갱신에 필요(없으면 갱신만 건너뜀)
 *   META_ACCESS_TOKEN                 ← 선택. DB에 토큰이 없을 때 이 값으로 부트스트랩
 *   META_API_VERSION                  ← 선택 (기본 v22.0)
 *   COLLECT_HOSPITAL_ID               ← 선택. 특정 병원만
 *   META_START_DATE / META_END_DATE   ← 선택. 과거 소급(Meta 인사이트는 약 37개월 보관)
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const API_VERSION = String(process.env.META_API_VERSION || "v22.0").trim();
const BASE = `https://graph.facebook.com/${API_VERSION}`;
/** 남은 유효기간이 이보다 적으면 토큰을 교환해 갱신한다. */
const REFRESH_WHEN_DAYS_LEFT = 14;
/** 기본 소급 폭 — 첫 수집이거나 이력이 없을 때. */
const DEFAULT_LOOKBACK_DAYS = 30;

function requiredEnv(name) {
  const v = String(process.env[name] || "").trim();
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function parseYmd(s) {
  const t = String(s || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) throw new Error(`Invalid date: ${t}`);
  return t;
}

function kstTodayYmd() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function addDaysYmd(ymd, days) {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** act_ 접두사를 보장한다(admin 입력이 숫자만인 경우 대비). */
function normalizeAdAccountId(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  return s.startsWith("act_") ? s : `act_${s.replace(/^act/, "")}`;
}

async function graphGet(pathname, params, token) {
  const usp = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`${BASE}${pathname}?${usp.toString()}`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const e = json.error || {};
    throw new Error(
      `Graph ${pathname} HTTP ${res.status}: ${e.message || JSON.stringify(json).slice(0, 500)} (code=${e.code ?? "?"})`,
    );
  }
  return json;
}

/** 페이지네이션을 따라 전부 모은다. 인사이트는 첫 페이지가 쉽게 잘린다(탐침에서 50행에서 끊겼다). */
async function graphGetAllPages(pathname, params, token) {
  const out = [];
  let json = await graphGet(pathname, params, token);
  for (;;) {
    out.push(...(json.data || []));
    const next = json.paging?.next;
    if (!next) break;
    const res = await fetch(next);
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.error) {
      const e = body.error || {};
      throw new Error(`Graph paging HTTP ${res.status}: ${e.message || "unknown"}`);
    }
    json = body;
  }
  return out;
}

// ── 토큰 ────────────────────────────────────────────────────────────────────

/** 토큰의 만료 시각(ISO) — 무기한이면 null. debug_token 은 앱 토큰(app_id|secret)으로 조회한다. */
async function inspectTokenExpiry(token, appId, appSecret) {
  if (!appId || !appSecret) return { expiresAt: null, known: false };
  const json = await graphGet(
    "/debug_token",
    { input_token: token },
    `${appId}|${appSecret}`,
  );
  const d = json.data || {};
  // expires_at = 0 → 만료 없음(System User 토큰 등)
  const secs = Number(d.expires_at ?? 0);
  if (!Number.isFinite(secs) || secs <= 0) return { expiresAt: null, known: true };
  return { expiresAt: new Date(secs * 1000).toISOString(), known: true };
}

/** 장기 토큰으로 교환(= 만료 갱신). 실패는 호출부에서 경고로 흘린다. */
async function exchangeForLongLivedToken(token, appId, appSecret) {
  const json = await graphGet("/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: token,
  });
  const next = String(json.access_token || "").trim();
  if (!next) throw new Error("exchange returned no access_token");
  return next;
}

/**
 * 쓸 토큰을 확정한다. DB 우선, 없으면 env 로 부트스트랩(첫 실행 편의).
 * 만료가 임박하면 교환해 DB에 저장한다. 만료 정보를 못 얻어도 수집은 계속한다.
 */
async function resolveAccessToken(supabase) {
  const appId = String(process.env.META_APP_ID || "").trim();
  const appSecret = String(process.env.META_APP_SECRET || "").trim();

  const { data: row, error } = await supabase
    .schema("analytics")
    .from("analytics_meta_credentials")
    .select("id,access_token,token_expires_at,app_id")
    .eq("id", "default")
    .maybeSingle();
  if (error) throw error;

  let token = String(row?.access_token || "").trim();
  let bootstrapped = false;
  if (!token) {
    token = String(process.env.META_ACCESS_TOKEN || "").trim();
    if (!token) {
      throw new Error(
        "Meta 액세스 토큰이 없습니다. analytics.analytics_meta_credentials(id='default') 에 넣거나 META_ACCESS_TOKEN env 로 부트스트랩하세요.",
      );
    }
    bootstrapped = true;
  }

  let expiresAt = row?.token_expires_at ?? null;
  try {
    const info = await inspectTokenExpiry(token, appId, appSecret);
    if (info.known) expiresAt = info.expiresAt;
  } catch (e) {
    console.warn(`[meta] 토큰 만료 확인 실패(계속 진행): ${e.message}`);
  }

  // 만료 임박 → 교환
  if (expiresAt && appId && appSecret) {
    const daysLeft = (new Date(expiresAt).getTime() - Date.now()) / 86400000;
    if (daysLeft < REFRESH_WHEN_DAYS_LEFT) {
      console.log(`[meta] 토큰 만료 ${daysLeft.toFixed(1)}일 남음 → 갱신 시도`);
      try {
        token = await exchangeForLongLivedToken(token, appId, appSecret);
        const info = await inspectTokenExpiry(token, appId, appSecret);
        expiresAt = info.known ? info.expiresAt : null;
        bootstrapped = true; // 새 값을 저장해야 함
        console.log(`[meta] 토큰 갱신 완료 (새 만료: ${expiresAt ?? "없음"})`);
      } catch (e) {
        // 갱신 실패는 치명적이지 않다(아직 유효). 다만 방치하면 조용히 죽으므로 크게 남긴다.
        console.error(`[meta] ⚠ 토큰 갱신 실패 — 만료되면 수집이 멈춥니다: ${e.message}`);
      }
    }
  } else if (!expiresAt) {
    console.log("[meta] 토큰 만료 없음(또는 확인 불가) — 갱신 건너뜀");
  }

  // DB 반영(부트스트랩·갱신·만료시각 변화)
  const patch = {
    id: "default",
    access_token: token,
    token_expires_at: expiresAt,
    app_id: appId || row?.app_id || null,
  };
  if (bootstrapped || (row && row.token_expires_at !== expiresAt)) {
    const { error: upErr } = await supabase
      .schema("analytics")
      .from("analytics_meta_credentials")
      .upsert(patch, { onConflict: "id" });
    if (upErr) throw upErr;
  }

  return { token, expiresAt };
}

// ── 수집 ────────────────────────────────────────────────────────────────────

function mapDailyRow(r, hospitalId, adAccountId) {
  return {
    metric_date: r.date_start,
    hospital_id: hospitalId,
    ad_account_id: adAccountId,
    campaign_id: String(r.campaign_id ?? ""),
    campaign_name: r.campaign_name ?? null,
    adset_id: String(r.adset_id ?? ""),
    adset_name: r.adset_name ?? null,
    ad_id: String(r.ad_id ?? ""),
    ad_name: r.ad_name ?? null,
    impressions: Number(r.impressions ?? 0),
    clicks: Number(r.clicks ?? 0),
    reach: Number(r.reach ?? 0),
    spend: Number(r.spend ?? 0),
    currency: r.account_currency ?? null,
    raw_payload: r,
    collected_at: new Date().toISOString(),
  };
}

/**
 * actions / action_values 를 세로형 행으로 펼친다.
 * 같은 (날짜, 광고, action_type) 이 중복돼 오면 뒤 값으로 합치지 않고 덮어쓴다 —
 * 업서트 PK 충돌을 만들지 않기 위해 Map 으로 유일화한다.
 */
function mapConversionRows(r, hospitalId, adAccountId) {
  const byType = new Map();
  for (const a of r.actions || []) {
    const t = String(a.action_type || "").trim();
    if (!t) continue;
    byType.set(t, {
      metric_date: r.date_start,
      hospital_id: hospitalId,
      ad_account_id: adAccountId,
      ad_id: String(r.ad_id ?? ""),
      action_type: t,
      action_count: Number(a.value ?? 0),
      action_value: null,
      collected_at: new Date().toISOString(),
    });
  }
  // 전환 금액(커머스가 아니면 대개 안 온다) — 같은 action_type 행에 붙인다.
  for (const v of r.action_values || []) {
    const t = String(v.action_type || "").trim();
    if (!t) continue;
    const hit = byType.get(t);
    const num = Number(v.value ?? 0);
    if (hit) hit.action_value = num;
    else {
      byType.set(t, {
        metric_date: r.date_start,
        hospital_id: hospitalId,
        ad_account_id: adAccountId,
        ad_id: String(r.ad_id ?? ""),
        action_type: t,
        action_count: 0,
        action_value: num,
        collected_at: new Date().toISOString(),
      });
    }
  }
  return [...byType.values()];
}

/** supabase upsert 는 큰 배열에서 느려지고 페이로드 한도가 있어 나눠 보낸다. */
async function upsertChunked(supabase, table, rows, onConflict, chunk = 500) {
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const { error } = await supabase.schema("analytics").from(table).upsert(slice, { onConflict });
    if (error) throw error;
  }
}

async function main() {
  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const supabaseKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

  const { token, expiresAt } = await resolveAccessToken(supabase);
  if (expiresAt) {
    const daysLeft = (new Date(expiresAt).getTime() - Date.now()) / 86400000;
    console.log(`[meta] 토큰 만료 ${new Date(expiresAt).toISOString()} (${daysLeft.toFixed(1)}일 남음)`);
  }

  const onlyHospital = String(process.env.COLLECT_HOSPITAL_ID || "").trim() || null;
  const endDate = parseYmd(String(process.env.META_END_DATE || addDaysYmd(kstTodayYmd(), -1)));
  const startOverride = String(process.env.META_START_DATE || "").trim() || null;

  const q = supabase
    .schema("core")
    .from("hospitals")
    .select("id,name,meta_ad_account_id,meta_is_active")
    .eq("meta_is_active", true)
    .order("id", { ascending: true });
  const { data: hospitalRows, error: hospErr } = onlyHospital ? await q.eq("id", onlyHospital) : await q;
  if (hospErr) throw hospErr;

  const targets = (hospitalRows || [])
    .map((r) => ({
      hospital_id: String(r.id || "").trim(),
      name: String(r.name || "").trim(),
      ad_account_id: normalizeAdAccountId(r.meta_ad_account_id),
    }))
    .filter((r) => r.hospital_id && r.ad_account_id);

  if (targets.length === 0) {
    console.log("활성화된 Meta 광고계정이 없습니다 (hospitals.meta_is_active + meta_ad_account_id 확인).");
    return;
  }

  for (const t of targets) {
    // 증분 시작일 — 마지막 적재일 다음날. 없으면 기본 소급.
    let start = startOverride;
    if (!start) {
      const { data: maxRow, error: maxErr } = await supabase
        .schema("analytics")
        .from("analytics_meta_ads_daily")
        .select("metric_date")
        .eq("hospital_id", t.hospital_id)
        .eq("ad_account_id", t.ad_account_id)
        .order("metric_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (maxErr) throw maxErr;
      start = maxRow?.metric_date
        ? addDaysYmd(String(maxRow.metric_date).slice(0, 10), 1)
        : addDaysYmd(endDate, -DEFAULT_LOOKBACK_DAYS);
    }

    if (start > endDate) {
      console.log(`최신 상태 — skip: ${t.name || t.hospital_id} (${t.ad_account_id})`);
      continue;
    }

    let rows;
    try {
      rows = await graphGetAllPages(
        `/${t.ad_account_id}/insights`,
        {
          level: "ad",
          time_increment: "1",
          time_range: JSON.stringify({ since: start, until: endDate }),
          fields: [
            "date_start",
            "account_currency",
            "campaign_id",
            "campaign_name",
            "adset_id",
            "adset_name",
            "ad_id",
            "ad_name",
            "impressions",
            "clicks",
            "reach",
            "spend",
            "actions",
            "action_values",
          ].join(","),
          limit: "500",
        },
        token,
      );
    } catch (e) {
      // 한 병원 실패가 나머지를 막지 않게 한다(계정 정지·권한 회수 등).
      console.error(`✗ ${t.name || t.hospital_id} (${t.ad_account_id}) 수집 실패: ${e.message}`);
      continue;
    }

    if (rows.length === 0) {
      console.log(`행 없음: ${t.name || t.hospital_id} (${t.ad_account_id}) ${start}..${endDate}`);
      continue;
    }

    const daily = rows.map((r) => mapDailyRow(r, t.hospital_id, t.ad_account_id));
    const conv = rows.flatMap((r) => mapConversionRows(r, t.hospital_id, t.ad_account_id));

    await upsertChunked(
      supabase,
      "analytics_meta_ads_daily",
      daily,
      "metric_date,hospital_id,ad_account_id,ad_id",
    );
    if (conv.length > 0) {
      await upsertChunked(
        supabase,
        "analytics_meta_ads_conversions_daily",
        conv,
        "metric_date,hospital_id,ad_account_id,ad_id,action_type",
      );
    }

    const { error: touchErr } = await supabase
      .schema("core")
      .from("hospitals")
      .update({ meta_last_synced_at: new Date().toISOString() })
      .eq("id", t.hospital_id);
    if (touchErr) throw touchErr;

    console.log(
      `OK: ${t.name || t.hospital_id} (${t.ad_account_id}) 성과 ${daily.length}행 · 전환 ${conv.length}행 · ${start}..${endDate}`,
    );
  }
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
