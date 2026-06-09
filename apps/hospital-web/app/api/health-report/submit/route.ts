import { NextRequest, NextResponse, after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { processExtractJob } from '@/lib/extract-jobs/process';

// 진료케이스(blog_case)·건강검진(hospital_notes) 비동기 제출.
// 접수(job)만 만들고 즉시 jobId 반환 → 추출/저장은 백그라운드(after)에서. 사용자는 기다리지 않아도 된다.
export const maxDuration = 800; // after() 백그라운드 작업이 이 안에서 돈다.

const TOKEN_COST = 50;

type Overview = {
  finalDiagnosis?: string;
  visitBackground?: string;
  patientNotes?: string;
  diagnosisMethod?: string;
  treatmentProcess?: string;
  aftercarePlan?: string;
  emphasis?: string;
};
type ImageGroupInput = { date?: string; paths?: string[] };
type Body = {
  kind?: 'blog_case' | 'hospital_notes';
  chartType?: string;
  storageBucket?: string;
  storagePaths?: string[];
  overview?: Overview;
  imageGroups?: ImageGroupInput[];
  emphasisText?: string;
  imagePaths?: string[];
};

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export async function POST(request: NextRequest) {
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

  const kind = body.kind === 'hospital_notes' ? 'hospital_notes' : body.kind === 'blog_case' ? 'blog_case' : null;
  const chartType = str(body.chartType);
  const storageBucket = str(body.storageBucket);
  const storagePaths = Array.isArray(body.storagePaths)
    ? body.storagePaths.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    : [];
  if (!kind || !chartType || storagePaths.length === 0) {
    return NextResponse.json({ error: 'kind, chartType, storagePaths는 필수입니다.' }, { status: 400 });
  }

  // 병원 id는 서버에서 사용자 프로필로 결정(클라이언트 임의 지정 방지).
  const { data: profile } = await supabase
    .schema('core')
    .from('users')
    .select('hospital_id, token_balance')
    .eq('id', user.id)
    .single();
  const hospitalId = (profile as { hospital_id?: string } | null)?.hospital_id;
  if (!hospitalId) return NextResponse.json({ error: '병원 정보를 찾을 수 없습니다.' }, { status: 400 });

  // 토큰 사전 점검(컬럼 없으면 미적용 — 기존 동작 유지).
  const balance = (profile as { token_balance?: number } | null)?.token_balance;
  const tokensReady = typeof balance === 'number';
  if (tokensReady && (balance as number) < TOKEN_COST) {
    return NextResponse.json(
      { error: `토큰이 부족합니다. (보유 ${(balance as number).toLocaleString()}, 필요 ${TOKEN_COST})` },
      { status: 402 },
    );
  }

  // 콘텐츠 payload 정규화(저장 라우트와 동일 형태). 워커는 source 만 덧씌워 그대로 저장.
  let jobPayload: Record<string, unknown>;
  if (kind === 'blog_case') {
    const o = body.overview ?? {};
    const imageGroups = (Array.isArray(body.imageGroups) ? body.imageGroups : [])
      .map((g) => ({
        date: typeof g?.date === 'string' ? g.date.trim() : '',
        paths: Array.isArray(g?.paths) ? g.paths.filter((p): p is string => typeof p === 'string' && p.length > 0) : [],
      }))
      .filter((g) => g.paths.length > 0);
    const imagePaths = imageGroups.flatMap((g) => g.paths);
    jobPayload = {
      overview: {
        final_diagnosis: str(o.finalDiagnosis),
        visit_background: str(o.visitBackground),
        patient_notes: str(o.patientNotes),
        diagnosis_method: str(o.diagnosisMethod),
        treatment_process: str(o.treatmentProcess),
        aftercare_plan: str(o.aftercarePlan),
        emphasis: str(o.emphasis),
      },
      image_paths: imagePaths,
      image_groups: imageGroups,
    };
  } else {
    const imagePaths = Array.isArray(body.imagePaths)
      ? body.imagePaths.filter((p): p is string => typeof p === 'string' && p.length > 0)
      : [];
    jobPayload = { emphasis_text: str(body.emphasisText), image_paths: imagePaths };
  }

  try {
    const srvc = createServiceRoleClient();
    const { data: inserted, error } = await srvc
      .schema('health_report')
      .from('extract_jobs')
      .insert({
        hospital_id: hospitalId,
        user_id: user.id,
        chart_type: chartType,
        kind,
        storage_bucket: storageBucket,
        storage_paths: storagePaths,
        payload: jobPayload,
        status: 'queued',
        token_cost: tokensReady ? TOKEN_COST : 0,
      })
      .select('id')
      .single();
    if (error || !inserted) throw new Error(error?.message ?? 'job 생성 실패');

    const jobId = (inserted as { id: string }).id;
    // 응답을 먼저 보낸 뒤 백그라운드로 처리. cron 안전망이 있으므로 여기서 실패해도 회복됨.
    after(async () => {
      try {
        await processExtractJob(jobId);
      } catch (e) {
        console.error('[submit] after processExtractJob error', jobId, e);
      }
    });

    return NextResponse.json({ ok: true, jobId, status: 'queued' }, { status: 202 });
  } catch (e) {
    console.error('POST /api/health-report/submit:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
}
