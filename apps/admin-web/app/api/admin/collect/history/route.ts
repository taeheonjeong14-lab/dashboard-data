import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

export const maxDuration = 10;

// 통합 수집 내역: 수동 경영통계 업로드(chart_upload_runs) + 자동 수집(collect_jobs)을
// 한 목록으로 합쳐 시간순으로 돌려준다. 자동 수집은 origin(manual/schedule)으로 출처를 구분.

type UpsertItem = { label: string; count: number; skipped?: boolean; dateRange?: string | null };
type StepItem = { index: number; name: string; error?: string };

export type CollectHistoryUnifiedItem = {
  key: string;
  kind: 'manual_stats' | 'auto';
  id: string;
  hospitalId: string | null;
  status: string;
  at: string; // 정렬·표시용 대표 시각
  startedAt: string | null;
  finishedAt: string | null;
  // manual_stats(경영통계 수동 업로드)
  chartType?: string | null;
  sourceFileName?: string | null;
  importedRows?: number;
  totalRows?: number;
  errorRows?: number;
  // auto(자동 수집)
  origin?: 'manual' | 'schedule';
  upserts?: UpsertItem[];
  failedSteps?: StepItem[];
  // 진행 중(running/pending) 항목의 단계별 진행률 표시용
  progress?: Record<string, { done: number; total: number; label?: string | null }>;
  stepsFilter?: string[] | null;
  doneStepNames?: string[];
};

export async function GET() {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const supabase = createServiceRoleClient();

  const [manualRes, autoRes] = await Promise.all([
    supabase
      .schema('analytics')
      .from('chart_upload_runs')
      .select('id, hospital_id, chart_type, source_file_name, status, total_rows, imported_rows, error_rows, started_at, finished_at')
      .order('started_at', { ascending: false })
      .limit(40),
    supabase
      .schema('analytics')
      .from('collect_jobs')
      .select('id, hospital_id, status, steps, upserts, origin, progress, steps_filter, created_at, started_at, finished_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(40),
  ]);

  if (manualRes.error) return NextResponse.json({ error: manualRes.error.message }, { status: 500 });
  if (autoRes.error) return NextResponse.json({ error: autoRes.error.message }, { status: 500 });

  // chart_upload_runs 는 completed/running/failed 어휘를 쓰고, UI(collect-history-panel)·collect_jobs 는
  // done/running/failed 를 쓴다. 통일하지 않으면 'completed' 가 UI switch 의 default('대기 중')로 떨어진다.
  const normalizeManualStatus = (s: string): string => (s === 'completed' ? 'done' : s);

  const manualItems: CollectHistoryUnifiedItem[] = (manualRes.data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    const startedAt = (row.started_at as string | null) ?? '';
    return {
      key: `manual:${String(row.id)}`,
      kind: 'manual_stats',
      id: String(row.id),
      hospitalId: (row.hospital_id as string | null) ?? null,
      status: normalizeManualStatus(String(row.status ?? '')),
      at: startedAt,
      startedAt: (row.started_at as string | null) ?? null,
      finishedAt: (row.finished_at as string | null) ?? null,
      chartType: (row.chart_type as string | null) ?? null,
      sourceFileName: (row.source_file_name as string | null) ?? null,
      importedRows: Number(row.imported_rows ?? 0),
      totalRows: Number(row.total_rows ?? 0),
      errorRows: Number(row.error_rows ?? 0),
    };
  });

  const autoItems: CollectHistoryUnifiedItem[] = (autoRes.data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    const createdAt = (row.created_at as string | null) ?? '';
    const upserts = Array.isArray(row.upserts) ? (row.upserts as UpsertItem[]) : [];
    const steps = Array.isArray(row.steps) ? (row.steps as StepItem[]) : [];
    const originRaw = String(row.origin ?? 'manual');
    const progress = (row.progress && typeof row.progress === 'object'
      ? (row.progress as Record<string, { done: number; total: number; label?: string | null }>)
      : {});
    const stepsFilter = Array.isArray(row.steps_filter) ? (row.steps_filter as string[]) : null;
    return {
      key: `auto:${String(row.id)}`,
      kind: 'auto',
      id: String(row.id),
      hospitalId: (row.hospital_id as string | null) ?? null,
      status: String(row.status ?? ''),
      at: createdAt,
      startedAt: (row.started_at as string | null) ?? null,
      finishedAt: (row.finished_at as string | null) ?? null,
      origin: originRaw === 'schedule' ? 'schedule' : 'manual',
      upserts,
      failedSteps: steps.filter((s) => s && s.error),
      progress,
      stepsFilter,
      doneStepNames: steps.filter((s) => s && !s.error).map((s) => s.name),
    };
  });

  const items = [...manualItems, ...autoItems]
    .sort((a, b) => (b.at || '').localeCompare(a.at || ''))
    .slice(0, 60);

  return NextResponse.json({ items });
}
