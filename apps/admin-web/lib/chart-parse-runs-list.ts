import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { firstNestedRecord } from '@/lib/chart-history-normalize';

/** chart-api `history-service` 목록과 동일 스키마 (vet-report·GET /api/history items) */
export type ParseRunListItem = {
  id: string;
  createdAt: string;
  friendlyId: string | null;
  hospitalId: string | null;
  hospitalName: string | null;
  ownerName: string | null;
  patientName: string | null;
  fromHospital: boolean;
};

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
    fromHospital: false,
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

  // 병원(hospital-ui) 제출 여부: hospital_notes content 가 있으면 표시
  const ids = items.map((i) => i.id);
  if (ids.length > 0) {
    const { data: notes } = await supabase
      .schema('health_report')
      .from('generated_run_content')
      .select('parse_run_id')
      .eq('content_type', 'hospital_notes')
      .in('parse_run_id', ids);
    const hospitalSet = new Set(
      (notes ?? []).map((n) => String((n as { parse_run_id?: unknown }).parse_run_id ?? '')),
    );
    for (const it of items) it.fromHospital = hospitalSet.has(it.id);
  }
  return items;
}
