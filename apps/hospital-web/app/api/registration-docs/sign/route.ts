import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

export const maxDuration = 60;

const BUCKET = 'hospital-docs';
const ALLOWED_EXT = new Set(['pdf', 'jpg', 'jpeg', 'png', 'webp']);

// POST /api/registration-docs/sign — 병원 등록 서류(사업자등록증·수의사신고필증) 서명 업로드 URL.
// 가입 직후(미승인) 마스터 본인이 업로드. 병원이 아직 없으므로 경로는 userId 로 scope.
// 클라이언트는 signUp 직후 로그인해 세션을 확보한 뒤 호출한다.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  let body: { kind?: string; ext?: string };
  try {
    body = (await request.json()) as { kind?: string; ext?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const kind = body.kind === 'vet' ? 'vet' : body.kind === 'biz' ? 'biz' : '';
  if (!kind) return NextResponse.json({ error: 'kind 는 biz|vet 이어야 합니다.' }, { status: 400 });
  const e = String(body.ext ?? '').toLowerCase();
  const ext = ALLOWED_EXT.has(e) ? e : 'pdf';

  try {
    const srvc = createServiceRoleClient();
    const path = `registrations/${user.id}/${kind}.${ext}`;
    const { data, error } = await srvc.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true });
    if (error || !data) throw new Error(error?.message ?? '서명 URL 생성 실패');
    return NextResponse.json({ path: data.path, token: data.token });
  } catch (err) {
    console.error('POST /api/registration-docs/sign:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
