/**
 * Supabase DB -> 블로그 키워드 순위 엑셀 내보내기
 *
 * Usage:
 *   node scripts/export-blog-ranks.js [outputPath]
 *   npm run export:ranks -- [outputPath]
 *
 * Env:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   RANK_EXPORT_START_DATE=YYYY-MM-DD (optional)
 *   RANK_EXPORT_END_DATE=YYYY-MM-DD (optional)
 */

const path = require("path");
const XLSX = require("xlsx");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const DEFAULT_OUTPUT = "output.xlsx";

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 필요합니다.");
  return createClient(url, key, { auth: { persistSession: false } });
}

function rankCell(v) {
  if (v == null) return "—";
  return `${v}위`;
}

async function fetchRows(supabase, startDate, endDate) {
  let q = supabase
    .schema("analytics")
    .from("analytics_blog_keyword_ranks")
    .select("account_id,keyword,metric_date,metric_key,rank_value,exposed_url,metadata")
    .in("metric_key", [
      "blog_rank_integrated",
      "blog_rank_pet_popular",
      "blog_rank_general",
      "blog_rank_tab",
    ])
    .order("metric_date", { ascending: false })
    .order("account_id", { ascending: true })
    .order("keyword", { ascending: true });

  if (startDate) q = q.gte("metric_date", startDate);
  if (endDate) q = q.lte("metric_date", endDate);

  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

function buildExcelRows(rows) {
  const byKey = new Map();
  for (const r of rows) {
    const k = `${r.metric_date}||${r.account_id}||${r.keyword}`;
    if (!byKey.has(k)) {
      byKey.set(k, {
        date: r.metric_date,
        blogId: r.account_id,
        keyword: r.keyword,
        integrated: null,
        integratedUrl: "",
        petPopular: null,
        petPopularUrl: "",
        general: null,
        generalUrl: "",
        tab: null,
        tabUrl: "",
      });
    }
    const item = byKey.get(k);
    if (r.metric_key === "blog_rank_integrated") {
      item.integrated = r.rank_value;
      item.integratedUrl = r.exposed_url || "";
    } else if (r.metric_key === "blog_rank_pet_popular") {
      item.petPopular = r.rank_value;
      item.petPopularUrl = r.exposed_url || "";
    } else if (r.metric_key === "blog_rank_general") {
      item.general = r.rank_value;
      item.generalUrl = r.exposed_url || "";
    } else if (r.metric_key === "blog_rank_tab") {
      item.tab = r.rank_value;
      item.tabUrl = r.exposed_url || "";
    }
  }

  const out = [[
    "수집일",
    "블로그 ID",
    "키워드",
    "검색결과",
    "검색결과 노출URL",
    "반려동물 인기글",
    "반려동물 인기글 노출URL",
    "일반 검색",
    "일반 검색 노출URL",
    "블로그(탭)",
    "블로그(탭) 노출URL",
  ]];

  for (const v of byKey.values()) {
    out.push([
      v.date,
      v.blogId,
      v.keyword,
      rankCell(v.integrated),
      v.integratedUrl,
      rankCell(v.petPopular),
      v.petPopularUrl,
      rankCell(v.general),
      v.generalUrl,
      rankCell(v.tab),
      v.tabUrl,
    ]);
  }
  return out;
}

async function main() {
  const outArg = process.argv[2] || DEFAULT_OUTPUT;
  const outPath = path.isAbsolute(outArg) ? outArg : path.join(process.cwd(), outArg);
  const startDate = process.env.RANK_EXPORT_START_DATE || null;
  const endDate = process.env.RANK_EXPORT_END_DATE || null;

  const supabase = getSupabaseClient();
  const rows = await fetchRows(supabase, startDate, endDate);
  const excelRows = buildExcelRows(rows);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(excelRows);
  XLSX.utils.book_append_sheet(wb, ws, "순위결과");
  XLSX.writeFile(wb, outPath);
  console.log(`엑셀 생성 완료: ${outPath} (${Math.max(excelRows.length - 1, 0)}행)`);
}

main().catch((err) => {
  console.error("엑셀 내보내기 실패:", err.message || err);
  process.exit(1);
});

