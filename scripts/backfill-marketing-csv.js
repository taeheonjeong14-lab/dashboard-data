/**
 * 과거 마케팅 데이터(블로그/플레이스) CSV → DB 백필.
 *
 * 스크래퍼는 과거로 갈 수 있는 일수가 제한적이라, 예전에 따로 모아둔 CSV를 같은 테이블/키로 채워 넣는다.
 * 저장 키는 scraper 와 동일: account_id(=네이버 블로그ID) + metric_date → 겹치면 덮어쓰고, 과거는 새로 insert.
 *
 * 테이블:
 *   blog  → analytics.analytics_blog_daily_metrics  (blog_views, blog_unique_visitors)
 *   place → analytics.analytics_smartplace_daily_metrics (smartplace_inflow)
 *
 * CSV 형식(헤더 줄은 자동 스킵 — 날짜가 YYYY-MM-DD 인 줄만 사용):
 *   블로그:  A=날짜, B=조회수, C=순방문자수
 *   플레이스: A=날짜, B=유입수
 *
 * Usage (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 있는 .env 옆에서):
 *   node scripts/backfill-marketing-csv.js blog  <블로그ID> tmp/과거데이터/정담_블로그.csv
 *   node scripts/backfill-marketing-csv.js place <블로그ID> tmp/과거데이터/정담_플레이스.csv
 *   (--dry 를 붙이면 파싱만 하고 DB에 안 씀)
 */

const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 식별자가 hospital_id(UUID)면 그 병원의 naver_blog_id 를 account_id 로 쓰고,
// 아니면 식별자 자체를 blogId(account_id)로 보고 병원을 역조회한다.
// account_id 는 스크래퍼와 동일해야(=naver_blog_id) 같은 계정으로 dedup/병합된다.
async function resolveAccount(supabase, ident) {
  const v = String(ident).trim();
  if (UUID_RE.test(v)) {
    const res = await supabase
      .schema("core")
      .from("hospitals")
      .select("id,name,naver_blog_id")
      .eq("id", v)
      .limit(1);
    if (res.error) throw res.error;
    if (!res.data || res.data.length === 0) return { hospitalId: null, hospitalName: null, accountId: null };
    const h = res.data[0];
    return {
      hospitalId: String(h.id),
      hospitalName: h.name || null,
      accountId: h.naver_blog_id ? String(h.naver_blog_id).trim() : null,
    };
  }
  const res = await supabase
    .schema("core")
    .from("hospitals")
    .select("id,name")
    .eq("naver_blog_id", v)
    .limit(1);
  if (res.error) throw res.error;
  if (!res.data || res.data.length === 0) return { hospitalId: null, hospitalName: null, accountId: v };
  return { hospitalId: String(res.data[0].id), hospitalName: res.data[0].name || null, accountId: v };
}

// 콤마 구분, 헤더/빈줄/꼬리컬럼 무시. 날짜(A)가 YYYY-MM-DD 인 줄만 데이터로 본다.
// CSV 인코딩(UTF-8/CP949)이 섞여 한글 헤더가 깨져도, 날짜·숫자는 ASCII라 위치 기반 파싱이 안전하다.
function parseCsv(filePath, kind) {
  const text = fs.readFileSync(filePath, "utf8");
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols = line.split(",");
    const date = (cols[0] || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const num = (i) => {
      const n = parseInt(String(cols[i] ?? "").trim(), 10);
      return Number.isFinite(n) ? n : null;
    };
    if (kind === "blog") {
      const views = num(1);
      if (views == null) continue;
      rows.push({ metric_date: date, blog_views: views, blog_unique_visitors: num(2) });
    } else {
      const inflow = num(1);
      if (inflow == null) continue;
      rows.push({ metric_date: date, smartplace_inflow: inflow });
    }
  }
  return rows;
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const [kind, ident, csvPath] = args.filter((a) => a !== "--dry");

  if (!["blog", "place"].includes(kind) || !ident || !csvPath) {
    console.error("Usage: node scripts/backfill-marketing-csv.js <blog|place> <블로그ID 또는 hospital_id(UUID)> <csv경로> [--dry]");
    process.exit(1);
  }
  if (!fs.existsSync(csvPath)) {
    console.error(`CSV 파일을 찾을 수 없습니다: ${csvPath}`);
    process.exit(1);
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 없어 DB 저장을 할 수 없습니다(.env 확인).");
    process.exit(1);
  }

  const { hospitalId, hospitalName, accountId } = await resolveAccount(supabase, ident);
  if (!hospitalId) {
    console.error(
      `'${ident}' 로 병원을 못 찾았습니다. (blogId면 core.hospitals.naver_blog_id, UUID면 hospitals.id 와 일치해야 함)`
    );
    process.exit(1);
  }
  if (!accountId) {
    console.error(
      `병원(${hospitalName})에 naver_blog_id 가 없어 account_id 를 정할 수 없습니다. core.hospitals.naver_blog_id 를 채우거나 블로그ID를 직접 넘겨주세요.`
    );
    process.exit(1);
  }

  const rows = parseCsv(csvPath, kind);
  if (rows.length === 0) {
    console.error("파싱된 데이터 행이 0건입니다. CSV 형식(A=날짜 YYYY-MM-DD)을 확인하세요.");
    process.exit(1);
  }
  rows.sort((a, b) => a.metric_date.localeCompare(b.metric_date));
  console.log(
    `파싱 ${rows.length}건 | 구간 ${rows[0].metric_date} ~ ${rows[rows.length - 1].metric_date} | hospital=${hospitalName || "-"}(${hospitalId}) | account_id=${accountId}`
  );

  if (dry) {
    console.log("미리보기 5건:", rows.slice(0, 5));
    console.log("--dry 모드 — DB에 쓰지 않았습니다.");
    return;
  }

  const table = kind === "blog" ? "analytics_blog_daily_metrics" : "analytics_smartplace_daily_metrics";
  const collectedAt = new Date().toISOString();
  const payload = rows.map((r) => ({
    account_id: accountId,
    hospital_id: hospitalId,
    hospital_name: hospitalName,
    metric_date: r.metric_date,
    ...(kind === "blog"
      ? { blog_views: r.blog_views, blog_unique_visitors: r.blog_unique_visitors }
      : { smartplace_inflow: r.smartplace_inflow }),
    metadata: { source: "csv_backfill" },
    collected_at: collectedAt,
  }));

  const CHUNK = 500;
  let done = 0;
  for (let i = 0; i < payload.length; i += CHUNK) {
    const slice = payload.slice(i, i + CHUNK);
    const { error } = await supabase
      .schema("analytics")
      .from(table)
      .upsert(slice, { onConflict: "account_id,metric_date" });
    if (error) throw error;
    done += slice.length;
    console.log(`  ...${done}/${payload.length}`);
  }
  console.log(`✅ ${table} 백필 완료: ${done}건 (account_id=${accountId})`);
}

main().catch((e) => {
  console.error("실패:", e.message);
  process.exit(1);
});
