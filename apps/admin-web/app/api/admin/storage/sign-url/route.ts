import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { formatSupabaseError } from '@/lib/format-supabase-error';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

// POST /api/admin/storage/sign-url — 업로드된 원본 파일(추가 자료 등) 열람용 서명 URL.
// 보안: extract-uploads/ 접두사 경로만 허용(임의 경로 서명 방지).
export async function POST(request: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  let body: { bucket?: string; path?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const bucket = String(body.bucket ?? '').trim();
  const path = String(body.path ?? '').trim();
  if (!bucket || !path) {
    return NextResponse.json({ error: 'bucket, path required' }, { status: 400 });
  }
  if (!path.startsWith('extract-uploads/') || path.includes('..')) {
    return NextResponse.json({ error: 'path not allowed' }, { status: 400 });
  }

  try {
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 10); // 10분
    if (error || !data?.signedUrl) {
      return NextResponse.json({ error: formatSupabaseError(error) || '서명 URL 생성 실패' }, { status: 500 });
    }
    return NextResponse.json({ url: data.signedUrl });
  } catch (e) {
    return NextResponse.json({ error: formatSupabaseError(e) }, { status: 500 });
  }
}
