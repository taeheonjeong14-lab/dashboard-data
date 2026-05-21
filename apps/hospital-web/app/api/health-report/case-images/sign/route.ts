import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

const CASE_IMAGE_BUCKET = 'case-image';
const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'webp']);

type SignBody = { runId?: string; exts?: string[] };

// POST /api/health-report/case-images/sign
// 병원 제출 이미지용 서명 업로드 URL 발급(서비스 롤). 브라우저는 받은 토큰으로 스토리지에 직접 업로드한다.
// 직접 업로드라 Vercel 함수 본문(4.5MB) 제한을 우회하고, case-image 버킷의 클라이언트 RLS 에도 의존하지 않는다.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  let body: SignBody;
  try {
    body = (await request.json()) as SignBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const runId = String(body.runId ?? '').trim();
  if (!runId) return NextResponse.json({ error: 'runId는 필수입니다.' }, { status: 400 });

  const exts = Array.isArray(body.exts) ? body.exts : [];
  if (exts.length === 0) return NextResponse.json({ uploads: [] });

  // 이미지 저장 경로는 세션의 병원으로 구성(클라이언트가 임의 경로를 지정하지 못하게 서버에서 결정).
  const { data: profile } = await supabase
    .schema('core')
    .from('users')
    .select('hospital_id')
    .eq('id', user.id)
    .single();
  const hospitalId = (profile as { hospital_id?: string } | null)?.hospital_id;
  if (!hospitalId) return NextResponse.json({ error: '병원 정보를 찾을 수 없습니다.' }, { status: 400 });

  try {
    const srvc = createServiceRoleClient();
    const uploads: { path: string; token: string }[] = [];
    for (const rawExt of exts) {
      const e = String(rawExt).toLowerCase();
      const ext = ALLOWED_EXT.has(e) ? e : 'jpg';
      const path = `${hospitalId}/${runId}/${randomUUID()}.${ext}`;
      const { data, error } = await srvc.storage.from(CASE_IMAGE_BUCKET).createSignedUploadUrl(path);
      if (error || !data) throw new Error(error?.message ?? '서명 URL 생성 실패');
      uploads.push({ path: data.path, token: data.token });
    }
    return NextResponse.json({ uploads });
  } catch (e) {
    console.error('POST /api/health-report/case-images/sign:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
