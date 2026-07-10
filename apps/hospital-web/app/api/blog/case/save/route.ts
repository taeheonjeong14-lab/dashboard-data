import { NextRequest, NextResponse } from 'next/server';
import { withErrorLog } from '@/lib/with-error-log';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

// 진료케이스 "케이스 개요"(차트에 없는 내용) + 사진 경로를
// health_report.generated_run_content (content_type='blog_case') 에 저장한다.
//
// 건강검진 리포트의 hospital_notes 와 같은 패턴: 브라우저 authenticated 롤은
// 이 테이블에 SELECT 만 가능하므로 서비스 롤 서버 라우트에서 upsert 한다.
// content_type='blog_case' 가 곧 "이 parse_run 은 진료케이스" 라는 표식이 되어
// admin 진료케이스 메뉴가 건강검진 run 과 구분해 목록화할 수 있다.

type Overview = {
  mainDisease?: string;
  comorbidities?: string;
  visitBackground?: string;
  patientNotes?: string;
  diagnosisMethod?: string;
  treatmentProcess?: string;
  aftercarePlan?: string;
  emphasis?: string;
};

type ImageGroupInput = { date?: string; paths?: string[] };
type Body = { runId?: string; overview?: Overview; imagePaths?: string[]; imageGroups?: ImageGroupInput[] };

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

export const POST = withErrorLog({ route: '/api/blog/case/save', feature: '진료케이스 저장' }, handlePOST);

async function handlePOST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const runId = String(body.runId ?? '').trim();
  if (!runId) return NextResponse.json({ error: 'runId는 필수입니다.' }, { status: 400 });

  const o = body.overview ?? {};
  const overview = {
    main_disease: str(o.mainDisease),
    comorbidities: str(o.comorbidities),
    visit_background: str(o.visitBackground),
    patient_notes: str(o.patientNotes),
    diagnosis_method: str(o.diagnosisMethod),
    treatment_process: str(o.treatmentProcess),
    aftercare_plan: str(o.aftercarePlan),
    emphasis: str(o.emphasis),
  };
  // 날짜별 그룹(신규) — [{ date, paths }]. 평탄 image_paths 는 그룹에서 펼쳐 호환 유지.
  const imageGroups = (Array.isArray(body.imageGroups) ? body.imageGroups : [])
    .map((g) => ({
      date: typeof g?.date === 'string' ? g.date.trim() : '',
      paths: Array.isArray(g?.paths)
        ? g.paths.filter((p): p is string => typeof p === 'string' && p.length > 0)
        : [],
    }))
    .filter((g) => g.paths.length > 0);
  const flatFromGroups = imageGroups.flatMap((g) => g.paths);
  const imagePaths =
    flatFromGroups.length > 0
      ? flatFromGroups
      : Array.isArray(body.imagePaths)
        ? body.imagePaths.filter((p): p is string => typeof p === 'string' && p.length > 0)
        : [];

  try {
    const srvc = createServiceRoleClient();
    const { error } = await srvc
      .schema('health_report')
      .from('generated_run_content')
      .upsert(
        {
          parse_run_id: runId,
          content_type: 'blog_case',
          payload: { source: 'hospital_web', overview, image_paths: imagePaths, image_groups: imageGroups },
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'parse_run_id,content_type' },
      );
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('POST /api/blog/case/save:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
