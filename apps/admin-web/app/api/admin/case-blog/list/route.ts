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

    // 작성 시작된 모든 진료케이스(작성중+완료) — 작성 단계 content 가 하나라도 있는 run.
    const { data: content, error: cErr } = await srvc
      .schema('health_report')
      .from('generated_run_content')
      .select('parse_run_id, content_type, payload, created_at, updated_at')
      .in('content_type', ['blog_causal', 'blog_detail', 'blog_outline', 'blog_post'])
      .order('created_at', { ascending: false });
    if (cErr) throw new Error(cErr.message);

    type GenRow = {
      parse_run_id: string;
      content_type: string;
      payload: { title?: string; bodyMarkdown?: string; tags?: string[]; confirmed?: unknown; saved?: unknown } | null;
      created_at: string;
      updated_at: string;
    };
    const gen = (content ?? []) as GenRow[];
    if (gen.length === 0) return NextResponse.json({ items: [] });

    // run 단위로 묶어 작성중/완료 판정 + blog_post 본문 확보
    type RunAgg = {
      createdAt: string; updatedAt: string;
      post?: { title: string; body: string; tags: string[]; confirmed: boolean; saved: boolean };
    };
    const byRun = new Map<string, RunAgg>();
    for (const g of gen) {
      let e = byRun.get(g.parse_run_id);
      if (!e) { e = { createdAt: g.created_at, updatedAt: g.updated_at }; byRun.set(g.parse_run_id, e); }
      if (g.created_at < e.createdAt) e.createdAt = g.created_at;
      if (g.updated_at > e.updatedAt) e.updatedAt = g.updated_at;
      if (g.content_type === 'blog_post') {
        const p = g.payload ?? {};
        e.post = {
          title: typeof p.title === 'string' ? p.title : '',
          body: typeof p.bodyMarkdown === 'string' ? p.bodyMarkdown : '',
          tags: Array.isArray(p.tags) ? p.tags.filter((t): t is string => typeof t === 'string') : [],
          confirmed: p.confirmed === true,
          saved: p.saved === true,
        };
      }
    }
    const runIds = [...byRun.keys()];
    const { data: runs, error: rErr } = await srvc
      .schema('chart_pdf')
      .from('parse_runs')
      .select('id, friendly_id, hospital_id, result_basic_info(hospital_name, owner_name, patient_name)')
      .in('id', runIds);
    if (rErr) throw new Error(rErr.message);

    // 주질환명 — blog_case(케이스 개요) overview.main_disease (구 데이터는 final_diagnosis 폴백)
    const { data: caseRows } = await srvc
      .schema('health_report')
      .from('generated_run_content')
      .select('parse_run_id, payload')
      .eq('content_type', 'blog_case')
      .in('parse_run_id', runIds);
    const finalDxByRun = new Map<string, string>();
    for (const cr of caseRows ?? []) {
      const r = cr as { parse_run_id?: string; payload?: { overview?: { main_disease?: string; final_diagnosis?: string } } };
      const dx = r.payload?.overview?.main_disease ?? r.payload?.overview?.final_diagnosis;
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

    const items = runIds.map((rid) => {
      const agg = byRun.get(rid)!;
      const run = runById.get(rid);
      const basic = basicOf(run);
      // 작성중 → 작성완료(확정) → 저장완료(네이버 임시저장 확인)
      const stage: 'writing' | 'drafted' | 'saved' =
        agg.post?.confirmed ? (agg.post.saved ? 'saved' : 'drafted') : 'writing';
      return {
        runId: rid,
        friendlyId: run?.friendly_id ?? null,
        hospitalName: nonEmpty(basic?.hospital_name),
        patientName: nonEmpty(basic?.patient_name),
        ownerName: nonEmpty(basic?.owner_name),
        finalDiagnosis: finalDxByRun.get(rid) ?? '',
        title: (agg.post?.title?.trim() || (stage === 'writing' ? '(작성 중)' : '(제목 없음)')),
        bodyMarkdown: agg.post?.body ?? '',
        tags: agg.post?.tags ?? [],
        stage,
        createdAt: agg.createdAt,
        updatedAt: agg.updatedAt,
      };
    });
    // 최근 작업 순(updatedAt desc)
    items.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

    return NextResponse.json({ items });
  } catch (e) {
    console.error('GET /api/admin/case-blog/list:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
}
