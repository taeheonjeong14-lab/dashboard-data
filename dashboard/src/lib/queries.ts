import type { User } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/auth";

export type RangeDays = 7 | 30 | 90;

export type BlogViewPoint = {
  metric_date: string;
  hospital_id: string | null;
  hospital_name: string | null;
  blog_views: number | null;
};

export type HospitalOption = {
  hospital_id: string;
  hospital_name: string;
};

export type HospitalScope = {
  isAdmin: boolean;
  hospitals: HospitalOption[];
};

function getStartDate(days: RangeDays) {
  const date = new Date();
  date.setDate(date.getDate() - (days - 1));
  return date.toISOString().slice(0, 10);
}

export async function fetchBlogViews(
  rangeDays: RangeDays,
  hospitalId: string | "all"
) {
  const supabase = getSupabaseClient();
  const startDate = getStartDate(rangeDays);

  let query = supabase
    .schema("analytics")
    .from("analytics_daily_metrics_daily_view")
    .select("metric_date,hospital_id,hospital_name,blog_views")
    .gte("metric_date", startDate)
    .not("blog_views", "is", null)
    .order("metric_date", { ascending: true });

  if (hospitalId !== "all") {
    query = query.eq("hospital_id", hospitalId);
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []) as BlogViewPoint[];
}

export async function fetchHospitalScope(user?: User | null): Promise<HospitalScope> {
  const supabase = getSupabaseClient();
  const resolved = user ?? (await getCurrentUser());
  if (!resolved) {
    return { isAdmin: false, hospitals: [] };
  }

  const { data: profile, error: profileError } = await supabase
    .schema("core")
    .from("users")
    .select("id,hospital_id,role")
    .eq("id", resolved.id)
    .maybeSingle();
  if (profileError) throw profileError;

  const role = String(profile?.role ?? "member").toLowerCase();
  const isAdmin = role === "admin";

  if (isAdmin) {
    const { data: hospitals, error: hospitalError } = await supabase
      .schema("core")
      .from("hospitals")
      .select("id,name")
      .order("name", { ascending: true });
    if (hospitalError) throw hospitalError;
    return {
      isAdmin: true,
      hospitals: (hospitals ?? []).map((row) => ({
        hospital_id: String(row.id),
        hospital_name: row.name ?? String(row.id),
      })),
    };
  }

  if (!profile?.hospital_id) return { isAdmin: false, hospitals: [] };

  const { data: hospitals, error: hospitalError } = await supabase
    .schema("core")
    .from("hospitals")
    .select("id,name")
    .eq("id", profile.hospital_id)
    .order("name", { ascending: true });
  if (hospitalError) throw hospitalError;

  return {
    isAdmin: false,
    hospitals: (hospitals ?? []).map((row) => ({
      hospital_id: String(row.id),
      hospital_name: row.name ?? String(row.id),
    })),
  };
}
