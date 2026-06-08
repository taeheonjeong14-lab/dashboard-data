import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

export const dynamic = 'force-dynamic';

// GET /api/admin/case-blog/list
// content_type='blog_post' 인 generated_run_content 를 parse_run 정보와 합쳐 진료케이스(블로그 글) 목록 반환.
export async function GET() {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  try {
    const srvc = createServiceRoleClient();

    const { data: content, error: cErr } = await srvc
      .schema('health_report')
      .from('generated_run_content')
      .select('parse_run_id, payload, created_at, updated_at')
      .eq('content_type', 'blog_post')
      .order('created_at', { ascending: false });
    if (cErr) throw new Error(cErr.message);

    type ContentRow = {
      parse_run_id: string;
      payload: { title?: string; bodyMarkdown?: string; tags?: string[] } | null;
      created_at: string;
      updated_at: string;
    };
    const rows = (content ?? []) as ContentRow[];
    if (rows.length === 0) return NextResponse.json({ items: [] });

    const runIds = [...new Set(rows.map((r) => r.parse_run_id))];
    const { data: runs, error: rErr } = await srvc
      .schema('chart_pdf')
      .from('parse_runs')
      .select('id, friendly_id, hospital_id, result_basic_info(hospital_name, owner_name, patient_name)')
      .in('id', runIds);
    if (rErr) throw new Error(rErr.message);

    // 최종 진단명 — blog_case(케이스 개요) overview.final_diagnosis
    const { data: caseRows } = await srvc
      .schema('health_report')
      .from('generated_run_content')
      .select('parse_run_id, payload')
      .eq('content_type', 'blog_case')
      .in('parse_run_id', runIds);
    const finalDxByRun = new Map<string, string>();
    for (const cr of caseRows ?? []) {
      const r = cr as { parse_run_id?: string; payload?: { overview?: { final_diagnosis?: string } } };
      const dx = r.payload?.overview?.final_diagnosis;
      if (r.parse_run_id && typeof dx === 'string' && dx.trim()) finalDxByRun.set(r.parse_run_id, dx.trim());
    }

    type BasicInfo = { hospital_name?: string | null; owner_name?: string | null; patient_name?: string | null };
    type RunRow = {
      id: string;
      friendly_id: string | null;
      hospital_id: string | null;
      result_basic_info: BasicInfo[] | BasicInfo | null;
    };
    const runById = new Map((runs ?? []).map((r) => [(r as RunRow).id, r as RunRow]));
    const nonEmpty = (v: unknown): string => (typeof v === 'string' && v.trim() ? v.trim() : '');
    const basicOf = (r: RunRow | undefined): BasicInfo | undefined => {
      const b = r?.result_basic_info;
      return Array.isArray(b) ? b[0] : b ?? undefined;
    };

    const items = rows.map((c) => {
      const run = runById.get(c.parse_run_id);
      const basic = basicOf(run);
      const payload = c.payload ?? {};
      return {
        runId: c.parse_run_id,
        friendlyId: run?.friendly_id ?? null,
        hospitalName: nonEmpty(basic?.hospital_name),
        patientName: nonEmpty(basic?.patient_name),
        ownerName: nonEmpty(basic?.owner_name),
        finalDiagnosis: finalDxByRun.get(c.parse_run_id) ?? '',
        title: nonEmpty(payload.title) || '(제목 없음)',
        bodyMarkdown: typeof payload.bodyMarkdown === 'string' ? payload.bodyMarkdown : '',
        tags: Array.isArray(payload.tags) ? payload.tags.filter((t): t is string => typeof t === 'string') : [],
        createdAt: c.created_at,
        updatedAt: c.updated_at,
      };
    });

    return NextResponse.json({ items });
  } catch (e) {
    console.error('GET /api/admin/case-blog/list:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
}
