import "dotenv/config";
import { GoogleAdsApi } from "google-ads-api";
import { createClient } from "@supabase/supabase-js";

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
    .select("hospital_id,customer_id,refresh_token_encrypted,is_active")
    .eq("is_active", true)
    .order("hospital_id", { ascending: true })
    .order("customer_id", { ascending: true });
  const { data: accounts, error: accErr } = hospitalId ? await accountsQuery.eq("hospital_id", hospitalId) : await accountsQuery;
  if (accErr) throw accErr;

  if (!accounts?.length) {
    console.log("No active Google Ads accounts found.");
    return;
  }

  const api = new GoogleAdsApi({
    client_id: oauthClientId,
    client_secret: oauthClientSecret,
    developer_token: developerToken,
  });

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

    const customer = api.Customer({
      customer_id: customerId,
      refresh_token: refreshToken,
    });

    const query = `
      SELECT
        segments.date,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros
      FROM customer
      WHERE segments.date BETWEEN '${effectiveStart}' AND '${endDate}'
    `;

    const rows = await customer.query(query);
    const payload = (rows || []).map((r) => ({
      metric_date: r.segments?.date,
      hospital_id: acc.hospital_id,
      customer_id: customerId,
      impressions: Number(r.metrics?.impressions || 0),
      clicks: Number(r.metrics?.clicks || 0),
      cost_micros: Number(r.metrics?.costMicros || r.metrics?.cost_micros || 0),
      raw_payload: r,
      collected_at: new Date().toISOString(),
    }));

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

