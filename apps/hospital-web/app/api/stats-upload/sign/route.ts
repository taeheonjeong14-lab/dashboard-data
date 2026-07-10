import { NextRequest, NextResponse } from 'next/server';
import { withErrorLog } from '@/lib/with-error-log';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { STATS_UPLOAD_BUCKET, ensureStatsUploadBucket } from '@/lib/stats-upload-storage';

const ALLOWED_EXT = ['xlsx', 'xls', 'csv'];

/**
 * 경영통계 파일을 Storage 에 직접 올리기 위한 서명 업로드 URL 발급.
 * 클라이언트는 이 URL(토큰)로 파일을 Storage 에 직접 업로드 → Vercel 함수 본문 한도를 우회한다.
 */
export const POST = withErrorLog({ route: '/api/stats-upload/sign', feature: '경영통계 업로드 서명' }, handlePOST);

async function handlePOST(req: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const { data: coreUser } = await supabase
      .schema('core')
      .from('users')
      .select('hospital_id')
      .eq('id', user.id)
      .single();
    const hospitalId = (coreUser as { hospital_id?: string | null } | null)?.hospital_id ?? null;
    if (!hospitalId) {
      return NextResponse.json({ error: '병원 정보를 찾을 수 없습니다.' }, { status: 400 });
    }

    const body = (await req.json().catch(() => null)) as { fileName?: unknown } | null;
    const fileName = typeof body?.fileName === 'string' ? body.fileName : 'upload';
    const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
    if (!ALLOWED_EXT.includes(ext)) {
      return NextResponse.json({ error: '엑셀(.xlsx, .xls) 또는 CSV(.csv) 파일만 업로드할 수 있습니다.' }, { status: 400 });
    }

    const srvc = createServiceRoleClient();
    await ensureStatsUploadBucket(srvc);

    // 경로는 항상 병원 ID prefix 아래로 — 처리 라우트에서 이 prefix 를 검증해 타 병원 파일 접근을 막는다.
    const path = `${hospitalId}/${crypto.randomUUID()}.${ext}`;
    const { data, error } = await srvc.storage.from(STATS_UPLOAD_BUCKET).createSignedUploadUrl(path);
    if (error || !data) {
      return NextResponse.json({ error: `업로드 URL 생성 실패: ${error?.message ?? ''}` }, { status: 500 });
    }

    return NextResponse.json({ bucket: STATS_UPLOAD_BUCKET, path: data.path, token: data.token });
  } catch (e) {
    console.error('[stats-upload/sign] unexpected error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
