import "dotenv/config";
import { OAuth2Client } from "google-auth-library";
import { createClient } from "@supabase/supabase-js";

/** Must match google-ads-api major version used by this repo's npm deps. */
const GOOGLE_ADS_API_VERSION = "v23";

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

function resolveGoogleAdsRefreshToken(value) {
  // Placeholder: support plain token or enc::... later (same pattern as SearchAd).
  return String(value || "").trim();
}

function normalizeDigits(id) {
  return String(id || "").replace(/-/g, "").trim();
}

/**
 * Paginated googleAds:search via REST.
 * Avoids google-ads-api bug where Axios errors without gRPC metadata crash in getGoogleAdsError (internalRepr.get).
 */
async function searchGoogleAdsAllPages({
  developerToken,
  clientId,
  clientSecret,
  refreshToken,
  customerId,
  loginCustomerId,
  gaql,
}) {
  const oauth2 = new OAuth2Client(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  const { token: accessToken } = await oauth2.getAccessToken();
  if (!accessToken) throw new Error("Failed to obtain Google OAuth access token");

  const cid = normalizeDigits(customerId);
  const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${cid}/googleAds:search`;

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": developerToken,
    "Content-Type": "application/json",
  };
  const lc = loginCustomerId ? normalizeDigits(loginCustomerId) : "";
  if (lc) headers["login-customer-id"] = lc;

  const rows = [];
  let pageToken;
  do {
    const body = { query: gaql };
    if (pageToken) body.pageToken = pageToken;

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Google Ads search HTTP ${res.status}: ${text.slice(0, 8000)}`);
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Google Ads search: invalid JSON: ${text.slice(0, 800)}`);
    }

    rows.push(...(data.results ?? []));
    pageToken = data.nextPageToken || undefined;
  } while (pageToken);

  return rows;
}

// 캠페인/광고그룹/키워드 어느 레벨이든 한 매퍼로 처리.
// 상위 레벨 쿼리는 하위 필드가 없으므로 `?? ""` 로 빈값 처리됨
// (예: campaign 쿼리 → ad_group_id="", keyword_id="").
function mapMetricRow(r, hospitalId, customerId) {
  const seg = r.segments ?? {};
  const m = r.metrics ?? {};
  const camp = r.campaign ?? {};
  const ag = r.adGroup ?? {};
  const crit = r.adGroupCriterion ?? {};
  const kw = crit.keyword ?? {};
  return {
    metric_date: seg.date,
    hospital_id: hospitalId,
    customer_id: customerId,
    campaign_id: String(camp.id ?? ""),
    campaign_name: camp.name ?? null,
    ad_group_id: String(ag.id ?? ""),
    ad_group_name: ag.name ?? null,
    keyword_id: String(crit.criterionId ?? ""),
    keyword_name: kw.text ?? null,
    impressions: Number(m.impressions ?? 0),
    clicks: Number(m.clicks ?? 0),
    cost_micros: Number(m.costMicros ?? m.cost_micros ?? 0),
    conversions: m.conversions != null ? Number(m.conversions) : null,
    raw_payload: r,
    collected_at: new Date().toISOString(),
  };
}

async function main() {
  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const supabaseKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

  const developerToken = requiredEnv("GOOGLEADS_DEVELOPER_TOKEN");
  const oauthClientId = requiredEnv("GOOGLEADS_OAUTH_CLIENT_ID");
  const oauthClientSecret = requiredEnv("GOOGLEADS_OAUTH_CLIENT_SECRET");

  const hospitalId = String(process.env.COLLECT_HOSPITAL_ID || "").trim() || null;

  const endDate = parseYmd(String(process.env.GOOGLEADS_END_DATE || addDaysYmd(kstTodayYmd(), -1)));
  const startDate = String(process.env.GOOGLEADS_START_DATE || "").trim() || null;

  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

  // Primary: core.hospitals
  const hospitalsQuery = supabase
    .schema("core")
    .from("hospitals")
    .select(
      "id,googleads_customer_id,googleads_refresh_token_encrypted,googleads_is_active,googleads_last_synced_at,googleads_metadata"
    )
    .eq("googleads_is_active", true)
    .order("id", { ascending: true });
  const { data: hospitalRows, error: hospitalErr } = hospitalId
    ? await hospitalsQuery.eq("id", hospitalId)
    : await hospitalsQuery;
  if (hospitalErr) throw hospitalErr;
  const accounts =
    (hospitalRows || [])
      .map((r) => ({
        hospital_id: String(r.id || "").trim(),
        customer_id: String(r.googleads_customer_id || "").trim(),
        refresh_token_encrypted: String(r.googleads_refresh_token_encrypted || "").trim(),
        metadata: r.googleads_metadata && typeof r.googleads_metadata === "object" ? r.googleads_metadata : {},
      }))
      .filter((r) => r.hospital_id && r.customer_id && r.refresh_token_encrypted) || [];

  if (!accounts?.length) {
    console.log("No active Google Ads accounts found.");
    return;
  }

  for (const acc of accounts) {
    const customerId = String(acc.customer_id || "").replace(/-/g, "").trim();
    const refreshToken = resolveGoogleAdsRefreshToken(acc.refresh_token_encrypted);
    if (!customerId || !refreshToken) {
      console.warn(`Skip: missing customer_id or refresh_token for hospital_id=${acc.hospital_id}`);
      continue;
    }

    // Determine incremental start date.
    let effectiveStart = startDate;
    if (!effectiveStart) {
      const { data: maxRow, error: maxErr } = await supabase
        .schema("analytics")
        .from("analytics_googleads_daily_metrics")
        .select("metric_date")
        .eq("hospital_id", acc.hospital_id)
        .eq("customer_id", customerId)
        .order("metric_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (maxErr) throw maxErr;
      effectiveStart = maxRow?.metric_date ? addDaysYmd(String(maxRow.metric_date).slice(0, 10), 1) : addDaysYmd(endDate, -30);
    }

    if (effectiveStart > endDate) {
      console.log(`Skip up-to-date: hospital_id=${acc.hospital_id}, customer_id=${customerId}`);
      continue;
    }

    const meta = acc.metadata && typeof acc.metadata === "object" ? acc.metadata : {};
    const loginFromDb = meta.login_customer_id || meta.loginCustomerId || "";
    const loginFromEnv = String(process.env.GOOGLEADS_LOGIN_CUSTOMER_ID || "").trim();
    const loginCustomerId = normalizeDigits(loginFromDb) || normalizeDigits(loginFromEnv) || "";

    // 캠페인 → 광고그룹 → 키워드 3단계 (네이버 SearchAd와 동일하게 한 테이블에 적재)
    const dateClause = `WHERE segments.date BETWEEN '${effectiveStart}' AND '${endDate}'`;
    const levelQueries = [
      `SELECT segments.date, campaign.id, campaign.name,
              metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
       FROM campaign ${dateClause}`,
      `SELECT segments.date, campaign.id, campaign.name, ad_group.id, ad_group.name,
              metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
       FROM ad_group ${dateClause}`,
      `SELECT segments.date, campaign.id, campaign.name, ad_group.id, ad_group.name,
              ad_group_criterion.criterion_id, ad_group_criterion.keyword.text,
              metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
       FROM keyword_view ${dateClause}`,
    ];

    const payload = [];
    for (const gaql of levelQueries) {
      const rows = await searchGoogleAdsAllPages({
        developerToken,
        clientId: oauthClientId,
        clientSecret: oauthClientSecret,
        refreshToken,
        customerId,
        loginCustomerId,
        gaql,
      });
      for (const r of rows || []) payload.push(mapMetricRow(r, acc.hospital_id, customerId));
    }

    if (!payload.length) {
      console.log(`No rows: hospital_id=${acc.hospital_id}, customer_id=${customerId}, range=${effectiveStart}..${endDate}`);
      continue;
    }

    const { error: upErr } = await supabase
      .schema("analytics")
      .from("analytics_googleads_daily_metrics")
      .upsert(payload, { onConflict: "metric_date,hospital_id,customer_id,campaign_id,ad_group_id,keyword_id" });
    if (upErr) throw upErr;

    // Primary touch: core.hospitals
    const { error: touchCoreErr } = await supabase
      .schema("core")
      .from("hospitals")
      .update({ googleads_last_synced_at: new Date().toISOString() })
      .eq("id", acc.hospital_id);
    if (touchCoreErr) throw touchCoreErr;

    console.log(
      `OK: hospital_id=${acc.hospital_id}, customer_id=${customerId}, rows=${payload.length}, range=${effectiveStart}..${endDate}`
    );
  }
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});

