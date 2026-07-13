import { chartAppAuthMiddleware } from "@/lib/chart-app/auth";
import type { NextRequest } from "next/server";
import { getLlmProvider, hasLlmApiKey } from "@/lib/llm-provider";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { dbChartPdf, dbCore, getSupabaseChartPdfSchema, getSupabaseCoreSchema } from "@/lib/supabase-db-schema";
import { PDF_UPLOAD_BUCKET } from "@/lib/supabase-storage-buckets";

export const runtime = "nodejs";

function maskSecret(v: string | undefined): string {
  if (!v) return "(없음)";
  return v.length <= 8 ? "***" : `${v.slice(0, 4)}…${v.slice(-4)}`;
}

export async function GET(request: NextRequest) {
  const authErr = chartAppAuthMiddleware(request);
  if (authErr) return authErr;

  const results: Record<string, { ok: boolean; detail: string; data?: Record<string, unknown> }> = {};

  // 1. 환경변수
  const envKeys = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GOOGLE_CLOUD_API_KEY: process.env.GOOGLE_CLOUD_API_KEY,
    SUPABASE_DB_SCHEMA: process.env.SUPABASE_DB_SCHEMA,
    SUPABASE_SCHEMA_CHART_PDF: process.env.SUPABASE_SCHEMA_CHART_PDF,
    SUPABASE_SCHEMA_CORE: process.env.SUPABASE_SCHEMA_CORE,
  };
  const missing = Object.entries(envKeys)
    .filter(([k, v]) => !v?.trim() && k !== "SUPABASE_DB_SCHEMA" && k !== "SUPABASE_SCHEMA_CHART_PDF" && k !== "SUPABASE_SCHEMA_CORE")
    .map(([k]) => k);
  results["1_env_vars"] = {
    ok: missing.length === 0,
    detail: missing.length === 0 ? "OK" : `미설정: ${missing.join(", ")}`,
    data: {
      SUPABASE_URL: envKeys.NEXT_PUBLIC_SUPABASE_URL?.trim() || "(없음)",
      SUPABASE_SERVICE_ROLE_KEY: maskSecret(envKeys.SUPABASE_SERVICE_ROLE_KEY),
      OPENAI_API_KEY: maskSecret(envKeys.OPENAI_API_KEY),
      GEMINI_API_KEY: maskSecret(envKeys.GEMINI_API_KEY),
      GOOGLE_CLOUD_API_KEY: maskSecret(envKeys.GOOGLE_CLOUD_API_KEY),
      chartPdfSchema: getSupabaseChartPdfSchema(),
      coreSchema: getSupabaseCoreSchema(),
      llmApiKeyPresent: hasLlmApiKey(),
      // 추출 동작을 좌우하는 설정(비밀값 아님) — 어떤 경로/청크 크기로 도는지 여기서 바로 확인한다.
      // LLM_PROVIDER 가 gemini 면 15p 초과 PDF 를 페이지 단위로 쪼개 전사하고, openai 면 청크 모드(기본 꺼짐)를 탄다.
      extraction: {
        llmProvider: getLlmProvider(),
        geminiReportModel: process.env.GEMINI_REPORT_MODEL?.trim() || "gemini-2.5-flash (기본)",
        pageRangeSize: Number(process.env.EXTRACT_PAGE_RANGE_SIZE) || 1,
        pageRangeOverlap: Number(process.env.EXTRACT_PAGE_RANGE_OVERLAP) || 0,
        maxPages: Number(process.env.TEXT_BUCKETING_MAX_PAGES) || 50,
        openAiChunkMode: process.env.ORDERED_LINES_CHUNK_MODE === "true",
      },
    },
  };

  // 2. Supabase parse_runs
  try {
    const supabase = getSupabaseServerClient();
    const db = dbChartPdf(supabase);
    const { count, error } = await db.from("parse_runs").select("*", { count: "exact", head: true });
    results["2_supabase_parse_runs"] = {
      ok: !error,
      detail: error ? `조회 실패: ${error.message}` : `OK (${count ?? 0}건)`,
      data: { schema: getSupabaseChartPdfSchema(), count },
    };
  } catch (e) {
    results["2_supabase_parse_runs"] = { ok: false, detail: `예외: ${e instanceof Error ? e.message : String(e)}` };
  }

  // 3. Supabase hospitals (core schema)
  try {
    const supabase = getSupabaseServerClient();
    const db = dbCore(supabase);
    const { count, error } = await db.from("hospitals").select("*", { count: "exact", head: true });
    results["3_supabase_hospitals"] = {
      ok: !error,
      detail: error ? `조회 실패: ${error.message}` : `OK (${count ?? 0}건)`,
      data: { schema: getSupabaseCoreSchema(), count },
    };
  } catch (e) {
    results["3_supabase_hospitals"] = { ok: false, detail: `예외: ${e instanceof Error ? e.message : String(e)}` };
  }

  // 4. Supabase storage
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase.storage.from(PDF_UPLOAD_BUCKET).list("extract-uploads", { limit: 3 });
    results["4_storage"] = {
      ok: !error,
      detail: error ? `Storage 실패: ${error.message}` : `OK (bucket=${PDF_UPLOAD_BUCKET})`,
      data: { recentFiles: (data ?? []).map((f) => f.name) },
    };
  } catch (e) {
    results["4_storage"] = { ok: false, detail: `예외: ${e instanceof Error ? e.message : String(e)}` };
  }

  const allOk = Object.values(results).every((r) => r.ok);
  return Response.json({ ok: allOk, results });
}
