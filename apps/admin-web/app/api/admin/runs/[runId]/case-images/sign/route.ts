import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

export const dynamic = 'force-dynamic';

const CASE_IMAGES_BUCKET = 'chart-case-images';
const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'webp']);
const MAX_IMAGES = 50;

// POST /api/admin/runs/[runId]/case-images/sign
// 클라이언트가 이미지를 스토리지에 "직접" 올릴 수 있도록 staging 경로의 서명 업로드 URL을 발급한다.
// (이미지 바이트가 서버 함수 본문을 거치지 않아 Vercel 요청 본문 4.5MB 한도를 우회한다.)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const { runId } = await params;
  if (!/^[0-9a-fA-F-]{36}$/.test(runId)) {
    return NextResponse.json({ error: 'runId 형식이 올바르지 않습니다.' }, { status: 400 });
  }

  let body: { exts?: unknown };
  try {
    body = (await request.json()) as { exts?: unknown };
  } catch {
    return NextResponse.json({ error: '요청 형식이 올바르지 않습니다.' }, { status: 400 });
  }
  const exts = Array.isArray(body.exts) ? body.exts : [];
  if (exts.length === 0) {
    return NextResponse.json({ error: '업로드할 이미지가 없습니다.' }, { status: 400 });
  }
  if (exts.length > MAX_IMAGES) {
    return NextResponse.json({ error: `이미지는 최대 ${MAX_IMAGES}장까지 가능합니다.` }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    if (!buckets?.some((b) => b.name === CASE_IMAGES_BUCKET)) {
      await supabase.storage.createBucket(CASE_IMAGES_BUCKET, { public: false });
    }

    const uploads = await Promise.all(
      exts.map(async (extRaw) => {
        const ext = String(extRaw ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
        const safeExt = ALLOWED_EXT.has(ext) ? ext : 'jpg';
        const path = `${runId}/_staging/${randomUUID()}.${safeExt}`;
        const { data, error } = await supabase.storage
          .from(CASE_IMAGES_BUCKET)
          .createSignedUploadUrl(path);
        if (error || !data) throw new Error(error?.message ?? '서명 URL 생성 실패');
        return { path, token: data.token };
      }),
    );
    return NextResponse.json({ uploads });
  } catch (e) {
    console.error('[case-images/sign] error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '업로드 URL 생성 실패' },
      { status: 500 },
    );
  }
}
