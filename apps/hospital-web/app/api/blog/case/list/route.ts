import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

// GET /api/blog/case/list
// 로그인한 병원이 제출한 진료케이스 목록.
// content_type='blog_case' 인 generated_run_content 를 이 병원의 parse_run 으로 한정해 반환한다.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const { data: profile } = await supabase
    .schema('core')
    .from('users')
    .select('hospital_id')
    .eq('id', user.id)
    .single();
  const hospitalId = (profile as { hospital_id?: string } | null)?.hospital_id;
  if (!hospitalId) {
    return NextResponse.json({ error: '병원 정보를 불러올 수 없습니다.' }, { status: 400 });
  }

  try {
    const srvc = createServiceRoleClient();

    // 이 병원의 parse_run 들 (generated_run_content 에는 hospital_id 가 없어 run 으로 한정)
    const { data: runs, error: runErr } = await srvc
      .schema('chart_pdf')
      .from('parse_runs')
      .select('id, friendly_id, created_at, result_basic_info(owner_name, patient_name)')
      .eq('hospital_id', hospitalId)
      .order('created_at', { ascending: false });
    if (runErr) throw new Error(runErr.message);

    type RunRow = {
      id: string;
      friendly_id: string | null;
      created_at: string;
      result_basic_info: { owner_name?: string | null; patient_name?: string | null }[] | { owner_name?: string | null; patient_name?: string | null } | null;
    };
    const runRows = (runs ?? []) as RunRow[];
    if (runRows.length === 0) return NextResponse.json({ items: [] });
    const runById = new Map(runRows.map((r) => [r.id, r]));

    const nonEmpty = (v: unknown): string => (typeof v === 'string' && v.trim() ? v.trim() : '');
    const basicOf = (r: RunRow | undefined) => {
      const b = r?.result_basic_info;
      return Array.isArray(b) ? b[0] : b;
    };

    const { data: content, error: cErr } = await srvc
      .schema('health_report')
      .from('generated_run_content')
      .select('parse_run_id, payload, created_at, updated_at')
      .eq('content_type', 'blog_case')
      .in(
        'parse_run_id',
        runRows.map((r) => r.id),
      );
    if (cErr) throw new Error(cErr.message);

    type ContentRow = {
      parse_run_id: string;
      payload: { overview?: Record<string, string>; image_paths?: string[] } | null;
      created_at: string;
      updated_at: string;
    };

    const items = ((content ?? []) as ContentRow[])
      .map((c) => {
        const run = runById.get(c.parse_run_id);
        const basic = basicOf(run);
        const overview = c.payload?.overview ?? {};
        const imagePaths = Array.isArray(c.payload?.image_paths) ? c.payload!.image_paths : [];
        return {
          runId: c.parse_run_id,
          friendlyId: run?.friendly_id ?? null,
          patientName: nonEmpty(basic?.patient_name),
          ownerName: nonEmpty(basic?.owner_name),
          finalDiagnosis: overview.final_diagnosis ?? '',
          imageCount: imagePaths.length,
          createdAt: c.created_at,
          updatedAt: c.updated_at,
        };
      })
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    return NextResponse.json({ items });
  } catch (e) {
    console.error('GET /api/blog/case/list:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
