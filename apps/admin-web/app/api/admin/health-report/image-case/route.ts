import { NextRequest, NextResponse } from 'next/server';
import { getCaseImageBucket } from '@/lib/chart-extraction/storage-config';
import { isParseRunUuid } from '@/lib/chart-extraction/uuid';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { createCaseImageSignedUrl } from '@/lib/health-report-admin/case-image-signing';
import {
  deleteAllImageRowsForRunFromSupabase,
  deleteImageRowFromSupabase,
  findStoragePathForImageFromSupabase,
  loadReportCaseImageRowsFromSupabase,
  listStoragePathsForRunFromSupabase,
} from '@/lib/health-report-admin/report-case-images-db';
export const dynamic = 'force-dynamic';

/** 서명 미리보기 TTL (초) — chart-api image-case 와 동일 */
const PREVIEW_TTL_SEC = 60 * 60 * 24 * 7;

function apiErrorMessage(e: unknown): string {
  if (typeof AggregateError !== 'undefined' && e instanceof AggregateError) {
    const agg = e as AggregateError;
    const parts: string[] = [];
    if (agg.message.trim()) parts.push(agg.message.trim());
    for (const sub of agg.errors ?? []) {
      if (sub instanceof Error && sub.message.trim()) parts.push(sub.message.trim());
      else if (sub != null && String(sub).trim()) parts.push(String(sub).trim());
    }
    const detail = [...new Set(parts)].join(' | ');
    if (detail) {
      return `${detail} — (AggregateError: 여러 하위 오류가 동시에 발생했습니다. 네트워크·Supabase·스토리지 등 로그를 확인해 주세요.)`;
    }
    return 'AggregateError(하위 메시지 없음). 서버 터미널 로그와 네트워크를 확인해 주세요.';
  }
  if (e instanceof Error && e.message.trim()) return e.message;
  if (e instanceof Error) return e.name || 'Error';
  if (typeof e === 'object' && e !== null && 'message' in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === 'string' && m.trim()) return m;
  }
  const s = String(e ?? '');
  return s.trim() ? s : '알 수 없는 서버 오류(메시지 없음). 터미널 서버 로그를 확인해 주세요.';
}

function formatExamDate(d: Date | string): string {
  try {
    if (typeof d === 'string') {
      return d.length >= 10 ? d.slice(0, 10) : d;
    }
    if (d instanceof Date && !Number.isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
    return '';
  } catch {
    return '';
  }
}

/** GET — chart_pdf 우선, 비어 있으면 vet-report 레거시 `public.report_case_images` */
export async function GET(request: NextRequest) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const runId = request.nextUrl.searchParams.get('runId')?.trim();
  if (!isParseRunUuid(runId)) {
    return NextResponse.json({ error: 'runId query parameter must be a valid UUID' }, { status: 400 });
  }

  try {
    const supabase = createServiceRoleClient();
    const rows = await loadReportCaseImageRowsFromSupabase(supabase, runId!);

    const images = await Promise.all(
      rows.map(async (row) => {
        const storagePath = row.storage_path != null ? String(row.storage_path).trim() : '';
        let previewUrl: string | null = null;
        if (storagePath) {
          try {
            previewUrl = await createCaseImageSignedUrl(supabase, storagePath, PREVIEW_TTL_SEC);
          } catch (signErr) {
            console.warn('[image-case GET] createSignedUrl failed for row', row.id, signErr);
          }
        }

        const isClearFinding =
          row.finding_confidence === 'clear' || (!row.has_notable_finding && row.finding_confidence == null);

        let findingSpots: unknown = row.finding_spots ?? undefined;
        if (findingSpots !== undefined && typeof findingSpots === 'object') {
          try {
            findingSpots = JSON.parse(JSON.stringify(findingSpots)) as unknown;
          } catch {
            findingSpots = undefined;
          }
        }

        return {
          id: String(row.id ?? ''),
          examDate: formatExamDate(row.exam_date),
          fileName: String(row.file_name ?? ''),
          examType: String(row.exam_type ?? ''),
          radiologySub: row.radiology_sub != null ? String(row.radiology_sub) : undefined,
          briefComment: String(row.brief_comment ?? ''),
          hasNotableFinding: Boolean(row.has_notable_finding),
          isClearFinding,
          findingSpots,
          relatedAssessmentCondition:
            row.related_assessment_condition != null ? String(row.related_assessment_condition) : undefined,
          storagePath: storagePath || String(row.storage_path ?? ''),
          previewUrl,
        };
      }),
    );

    return NextResponse.json({ runId, images });
  } catch (e) {
    console.error('GET /api/admin/health-report/image-case:', e);
    return NextResponse.json({ error: apiErrorMessage(e) }, { status: 500 });
  }
}

/** DELETE — 스토리지 + DB (chart_pdf · public 모두 처리) */
export async function DELETE(request: NextRequest) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const runId = url.searchParams.get('runId')?.trim();
  const imageId = url.searchParams.get('imageId')?.trim();
  if (!runId || !isParseRunUuid(runId)) {
    return NextResponse.json({ error: 'runId required' }, { status: 400 });
  }

  try {
    const supabase = createServiceRoleClient();
    const bucket = getCaseImageBucket();

    if (imageId) {
      const path = await findStoragePathForImageFromSupabase(supabase, runId, imageId);
      if (!path) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      await supabase.storage.from(bucket).remove([path]);
      const deleted = await deleteImageRowFromSupabase(supabase, runId, imageId);
      if (!deleted) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
    } else {
      const paths = await listStoragePathsForRunFromSupabase(supabase, runId);
      if (paths.length > 0) {
        await supabase.storage.from(bucket).remove(paths);
      }
      await deleteAllImageRowsForRunFromSupabase(supabase, runId);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('DELETE /api/admin/health-report/image-case:', e);
    return NextResponse.json({ error: apiErrorMessage(e) }, { status: 500 });
  }
}
