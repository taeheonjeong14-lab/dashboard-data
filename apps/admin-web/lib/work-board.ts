import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { firstNestedRecord } from '@/lib/chart-history-normalize';
import { computeBlogStage, computeHealthStage, type BlogStage, type HealthStage } from '@/lib/case-status';

// 작업 현황판 — hospital-ui 에서 요청된 검진리포트(hospital_notes)·블로그(blog_case) 작업을
// 케이스(run)·종류 단위로 모아 잔여/완료로 나눠 보여준다.
//  · 요청 일시 = 차트 업로드(run.created_at)
//  · 완료 일시 = 해당 종류 결과물 생성/확정 시각(health_checkup·blog_post 의 updated_at)

export type WorkItemType = 'health' | 'blog';

export type WorkItem = {
  runId: string;
  friendlyId: string | null;
  hospitalId: string | null;
  hospitalName: string | null;
  ownerName: string | null;
  patientName: string | null;
  type: WorkItemType;
  /** 블로그: requested|writing|drafted(작성완료)|saved(저장완료) · 검진: requested|done */
  stage: BlogStage | HealthStage;
  requestedAt: string; // run 생성 시각
  completedAt: string | null; // 완료(검진 done·블로그 saved) 시각 — 그 외 null
  draftedAt: string | null; // 블로그 작성완료(확정) 시각 — 그 외 null
};

const STATUS_CONTENT_TYPES = [
  'hospital_notes', 'blog_case', 'health_checkup', 'blog_causal', 'blog_detail', 'blog_outline', 'blog_post',
];

function nonEmptyText(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}
function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  return v != null ? String(v) : '';
}

type RunAgg = {
  types: Set<string>;
  blogConfirmed: boolean;
  blogSaved: boolean;
  blogCompletedAt: string | null;   // blog_post 저장완료 시각(payload.savedAt ?? updated_at)
  blogDraftedAt: string | null;     // blog_post 작성완료(확정) 시각 — 미저장 상태의 updated_at
  healthCompletedAt: string | null; // health_checkup updated_at
};

export async function listWorkBoardItems(): Promise<WorkItem[]> {
  const supabase = createServiceRoleClient();

  // 1) hospital-ui 제출/생성 콘텐츠 전부(요청·중간·완료) — run 별로 모은다.
  const { data: contents, error: cErr } = await supabase
    .schema('health_report')
    .from('generated_run_content')
    .select('parse_run_id, content_type, payload, created_at, updated_at')
    .in('content_type', STATUS_CONTENT_TYPES)
    .order('updated_at', { ascending: false })
    .limit(5000);
  if (cErr) throw new Error(cErr.message);

  const byRun = new Map<string, RunAgg>();
  for (const c of contents ?? []) {
    const row = c as Record<string, unknown>;
    const rid = String(row.parse_run_id ?? '').trim();
    const ct = String(row.content_type ?? '').trim();
    if (!rid || !ct) continue;
    let agg = byRun.get(rid);
    if (!agg) { agg = { types: new Set(), blogConfirmed: false, blogSaved: false, blogCompletedAt: null, blogDraftedAt: null, healthCompletedAt: null }; byRun.set(rid, agg); }
    agg.types.add(ct);
    if (ct === 'health_checkup') agg.healthCompletedAt = toIso(row.updated_at) || toIso(row.created_at);
    if (ct === 'blog_post') {
      const pl = row.payload as { confirmed?: unknown; saved?: unknown; savedAt?: unknown } | null;
      if (pl && pl.confirmed === true) { agg.blogConfirmed = true; agg.blogDraftedAt = toIso(row.updated_at) || toIso(row.created_at); }
      if (pl && pl.saved === true) {
        // 저장완료 시각: payload.savedAt 우선, 없으면(구 데이터 백필) blog_post updated_at 폴백.
        agg.blogSaved = true;
        agg.blogCompletedAt = toIso(pl.savedAt) || toIso(row.updated_at) || toIso(row.created_at);
      }
    }
  }

  const runIds = [...byRun.keys()];
  if (runIds.length === 0) return [];

  // 2) run 기본정보(요청 시각·병원·보호자·환자) — id 청크로 조회.
  const basicByRun = new Map<string, { createdAt: string; friendlyId: string | null; hospitalId: string | null; hospitalName: string | null; ownerName: string | null; patientName: string | null }>();
  const CHUNK = 200;
  for (let i = 0; i < runIds.length; i += CHUNK) {
    const slice = runIds.slice(i, i + CHUNK);
    const { data: runs, error: rErr } = await supabase
      .schema('chart_pdf')
      .from('parse_runs')
      .select('id, created_at, friendly_id, hospital_id, result_basic_info(hospital_name, owner_name, patient_name)')
      .in('id', slice);
    if (rErr) throw new Error(rErr.message);
    for (const r of runs ?? []) {
      const row = r as Record<string, unknown>;
      const id = String(row.id ?? '').trim();
      if (!id) continue;
      const basic = firstNestedRecord(row.result_basic_info);
      const hid = row.hospital_id;
      basicByRun.set(id, {
        createdAt: toIso(row.created_at),
        friendlyId: nonEmptyText(row.friendly_id),
        hospitalId: hid != null && String(hid).trim() ? String(hid).trim() : null,
        hospitalName: nonEmptyText(basic?.hospital_name),
        ownerName: nonEmptyText(basic?.owner_name),
        patientName: nonEmptyText(basic?.patient_name),
      });
    }
  }

  // 3) run × 종류 → 작업 항목.
  const items: WorkItem[] = [];
  for (const [rid, agg] of byRun) {
    const basic = basicByRun.get(rid);
    if (!basic) continue; // run 이 삭제됐거나 조회 실패
    const base = {
      runId: rid,
      friendlyId: basic.friendlyId,
      hospitalId: basic.hospitalId,
      hospitalName: basic.hospitalName,
      ownerName: basic.ownerName,
      patientName: basic.patientName,
      requestedAt: basic.createdAt,
    };
    const healthStage = computeHealthStage(agg.types);
    if (healthStage !== 'none') {
      items.push({ ...base, type: 'health', stage: healthStage, completedAt: healthStage === 'done' ? agg.healthCompletedAt : null, draftedAt: null });
    }
    const blogStage = computeBlogStage(agg.types, agg.blogConfirmed, agg.blogSaved);
    if (blogStage !== 'none') {
      // 블로그는 '저장완료'(saved)가 진짜 완료 — 작성완료(drafted)는 아직 잔여(네이버 저장 대기).
      items.push({
        ...base, type: 'blog', stage: blogStage,
        completedAt: blogStage === 'saved' ? agg.blogCompletedAt : null,
        draftedAt: blogStage === 'drafted' ? agg.blogDraftedAt : null,
      });
    }
  }
  return items;
}
