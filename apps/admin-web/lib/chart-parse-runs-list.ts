import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { firstNestedRecord } from '@/lib/chart-history-normalize';
import { computeBlogStage, computeHealthStage, type BlogStage, type HealthStage } from '@/lib/case-status';

/** chart-api `history-service` 목록과 동일 스키마 (vet-report·GET /api/history items) */
export type ParseRunListItem = {
  id: string;
  createdAt: string;
  friendlyId: string | null;
  hospitalId: string | null;
  hospitalName: string | null;
  ownerName: string | null;
  patientName: string | null;
  /** hospital-ui 건강검진 리포트 제출(hospital_notes 존재) */
  isHealthCheckup: boolean;
  /** hospital-ui 블로그 컨텐츠 제출(blog_case 존재) */
  isBlog: boolean;
  blogStage: BlogStage;
  healthStage: HealthStage;
};

const STATUS_CONTENT_TYPES = [
  'hospital_notes', 'blog_case', 'health_checkup', 'blog_causal', 'blog_detail', 'blog_outline', 'blog_post',
];

function nonEmptyText(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function mapParseRunRow(row: Record<string, unknown>): ParseRunListItem | null {
  const id = String(row.id ?? '').trim();
  if (!id) return null;
  let createdAt = '';
  const ca = row.created_at;
  if (ca instanceof Date) createdAt = ca.toISOString();
  else if (typeof ca === 'string') createdAt = ca;
  else if (ca != null) createdAt = String(ca);
  const basic = firstNestedRecord(row.result_basic_info);
  const hid = row.hospital_id;
  const hospitalId =
    hid != null && String(hid).trim().length > 0 ? String(hid).trim() : null;
  const fid = row.friendly_id;
  const friendlyId =
    typeof fid === 'string' ? fid : fid != null && String(fid).trim() ? String(fid) : null;
  return {
    id,
    createdAt,
    friendlyId,
    hospitalId,
    hospitalName: nonEmptyText(basic?.hospital_name),
    ownerName: nonEmptyText(basic?.owner_name),
    patientName: nonEmptyText(basic?.patient_name),
    isHealthCheckup: false,
    isBlog: false,
    blogStage: 'none',
    healthStage: 'none',
  };
}

/**
 * `chart_pdf.parse_runs` 전체 행 수 — PostgREST(HTTPS), `DATABASE_URL`/5432 불필요.
 */
export async function countParseRunsInChartPdf(): Promise<number> {
  const supabase = createServiceRoleClient();
  const { count, error } = await supabase
    .schema('chart_pdf')
    .from('parse_runs')
    .select('*', { count: 'exact', head: true });
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/**
 * vet-report와 동일: `@supabase/supabase-js` → PostgREST embed `result_basic_info`.
 */
export async function listRecentParseRuns(limit = 80): Promise<ParseRunListItem[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .schema('chart_pdf')
    .from('parse_runs')
    .select(
      'id, created_at, friendly_id, hospital_id, result_basic_info(hospital_name, owner_name, patient_name)',
    )
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Record<string, unknown>[];
  const items = rows.map(mapParseRunRow).filter((r): r is ParseRunListItem => r != null);

  // hospital-ui 제출 출처 표시: hospital_notes=건강검진, blog_case=블로그.
  const ids = items.map((i) => i.id);
  if (ids.length > 0) {
    const { data: contents } = await supabase
      .schema('health_report')
      .from('generated_run_content')
      .select('parse_run_id, content_type')
      .in('content_type', STATUS_CONTENT_TYPES)
      .in('parse_run_id', ids);
    const typesByRun = new Map<string, Set<string>>();
    for (const c of contents ?? []) {
      const rid = String((c as { parse_run_id?: unknown }).parse_run_id ?? '');
      const ct = String((c as { content_type?: unknown }).content_type ?? '');
      if (!rid || !ct) continue;
      let s = typesByRun.get(rid);
      if (!s) { s = new Set(); typesByRun.set(rid, s); }
      s.add(ct);
    }
    // blog_post 확정/저장 여부(작성완료·저장완료 판정)
    const confirmedRuns = new Set<string>();
    const savedRuns = new Set<string>();
    const { data: posts } = await supabase
      .schema('health_report')
      .from('generated_run_content')
      .select('parse_run_id, payload')
      .eq('content_type', 'blog_post')
      .in('parse_run_id', ids);
    for (const p of posts ?? []) {
      const rid = String((p as { parse_run_id?: unknown }).parse_run_id ?? '');
      const pl = (p as { payload?: { confirmed?: unknown; saved?: unknown } }).payload;
      if (rid && pl && pl.confirmed === true) confirmedRuns.add(rid);
      if (rid && pl && pl.saved === true) savedRuns.add(rid);
    }
    for (const it of items) {
      const types = typesByRun.get(it.id) ?? new Set<string>();
      it.blogStage = computeBlogStage(types, confirmedRuns.has(it.id), savedRuns.has(it.id));
      it.healthStage = computeHealthStage(types);
      it.isBlog = it.blogStage !== 'none';
      it.isHealthCheckup = it.healthStage !== 'none';
    }
  }
  return items;
}
