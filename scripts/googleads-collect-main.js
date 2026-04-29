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

function mapDailyMetricRow(r, hospitalId, customerId) {
  const segments = r.segments ?? {};
  const metrics = r.metrics ?? {};
  const metricDate = segments.date;
  return {
    metric_date: metricDate,
    hospital_id: hospitalId,
    customer_id: customerId,
    impressions: Number(metrics.impressions ?? 0),
    clicks: Number(metrics.clicks ?? 0),
    cost_micros: Number(metrics.costMicros ?? metrics.cost_micros ?? 0),
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

  const accountsQuery = supabase
    .schema("analytics")
    .from("analytics_googleads_accounts")
    .select("hospital_id,customer_id,refresh_token_encrypted,is_active,metadata")
    .eq("is_active", true)
    .order("hospital_id", { ascending: true })
    .order("customer_id", { ascending: true });
  const { data: accounts, error: accErr } = hospitalId ? await accountsQuery.eq("hospital_id", hospitalId) : await accountsQuery;
  if (accErr) throw accErr;

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

    const query = `
      SELECT
        segments.date,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros
      FROM customer
      WHERE segments.date BETWEEN '${effectiveStart}' AND '${endDate}'
    `;

    const meta = acc.metadata && typeof acc.metadata === "object" ? acc.metadata : {};
    const loginFromDb = meta.login_customer_id || meta.loginCustomerId || "";
    const loginFromEnv = String(process.env.GOOGLEADS_LOGIN_CUSTOMER_ID || "").trim();
    const loginCustomerId = normalizeDigits(loginFromDb) || normalizeDigits(loginFromEnv) || "";

    const rows = await searchGoogleAdsAllPages({
      developerToken,
      clientId: oauthClientId,
      clientSecret: oauthClientSecret,
      refreshToken,
      customerId,
      loginCustomerId,
      gaql: query,
    });

    const payload = (rows || []).map((r) => mapDailyMetricRow(r, acc.hospital_id, customerId));

    if (!payload.length) {
      console.log(`No rows: hospital_id=${acc.hospital_id}, customer_id=${customerId}, range=${effectiveStart}..${endDate}`);
      continue;
    }

    const { error: upErr } = await supabase
      .schema("analytics")
      .from("analytics_googleads_daily_metrics")
      .upsert(payload, { onConflict: "metric_date,hospital_id,customer_id" });
    if (upErr) throw upErr;

    const { error: touchErr } = await supabase
      .schema("analytics")
      .from("analytics_googleads_accounts")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("hospital_id", acc.hospital_id)
      .eq("customer_id", customerId);
    if (touchErr) throw touchErr;

    console.log(
      `OK: hospital_id=${acc.hospital_id}, customer_id=${customerId}, days=${payload.length}, range=${effectiveStart}..${endDate}`
    );
  }
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});

