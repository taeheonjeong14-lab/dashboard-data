import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

type Body = { runId?: string; emphasisText?: string; imagePaths?: string[] };

// POST /api/health-report/hospital-notes
// 병원(hospital-ui) 제출의 강조사항 + 이미지 경로를
// health_report.generated_run_content (content_type='hospital_notes') 에 저장한다.
//
// 브라우저 authenticated 롤은 이 테이블에 INSERT/UPDATE 권한이 없어(SELECT 만 grant)
// 클라이언트 직접 upsert 가 조용히 실패하던 문제를 서비스 롤 서버 라우트로 해결.
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

  const runId = String(body.runId ?? '').trim();
  if (!runId) return NextResponse.json({ error: 'runId는 필수입니다.' }, { status: 400 });

  const emphasisText = typeof body.emphasisText === 'string' ? body.emphasisText : '';
  const imagePaths = Array.isArray(body.imagePaths)
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
          content_type: 'hospital_notes',
          payload: { source: 'hospital_web', emphasis_text: emphasisText, image_paths: imagePaths },
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'parse_run_id,content_type' },
      );
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('POST /api/health-report/hospital-notes:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
