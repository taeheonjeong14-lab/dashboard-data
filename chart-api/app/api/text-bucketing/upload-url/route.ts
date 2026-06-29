import { NextRequest, NextResponse } from 'next/server';
import { chartAppAuthMiddleware } from '@/lib/chart-app/auth';
import { getChartAppSupabaseService } from '@/lib/chart-app/supabase-service';
import { getPdfUploadsBucket } from '@/lib/chart-app/storage-config';
import { absolutizeSupabaseStorageUrl } from '@/lib/chart-app/supabase-url';
import { buildExtractUploadStoragePath } from '@/lib/chart-app/upload-path';

const MAX_BYTES = 30 * 1024 * 1024;

type UploadUrlBody = {
  fileName?: string;
  fileType?: string;
  fileSize?: number;
};

// POST /api/text-bucketing/upload-url — PDF 업로드용 서명 URL (vet-report 호환)
export async function POST(request: NextRequest) {
  const authErr = chartAppAuthMiddleware(request);
  if (authErr) return authErr;

  let body: UploadUrlBody;
  try {
    body = (await request.json()) as UploadUrlBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';
  const fileType = typeof body.fileType === 'string' ? body.fileType.trim().toLowerCase() : '';
  const fileSize = typeof body.fileSize === 'number' ? body.fileSize : NaN;

  if (!fileName) {
    return NextResponse.json({ error: 'fileName is required' }, { status: 400 });
  }
  // 차트 PDF + 추가 자료(외부 검사 결과서)용 — PDF 또는 이미지 허용.
  const okType = fileType === 'application/pdf' || /^image\/(png|jpe?g|webp)$/.test(fileType);
  if (!okType) {
    return NextResponse.json({ error: 'fileType must be application/pdf or image/(png|jpeg|webp)' }, { status: 400 });
  }
  if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_BYTES) {
    return NextResponse.json(
      { error: `fileSize must be between 1 and ${MAX_BYTES} bytes` },
      { status: 400 },
    );
  }

  const storagePath = buildExtractUploadStoragePath(fileName);

  try {
    const bucket = getPdfUploadsBucket();
    const supabase = getChartAppSupabaseService();
    const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(storagePath);

    if (error || !data) {
      console.error('createSignedUploadUrl:', bucket, error);
      return NextResponse.json(
        {
          error: 'Storage signing failed',
          bucket,
          supabaseError: error?.message ?? 'unknown',
          hint:
            'Supabase Storage에서 해당 버킷을 만들었는지, NEXT_PUBLIC_SUPABASE_URL·SUPABASE_SERVICE_ROLE_KEY가 그 프로젝트 것인지 확인하세요. 오류 메시지가 "not found" 계열이면 버킷 이름·존재 여부를 점검하세요.',
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      bucket,
      storagePath,
      signedUrl: absolutizeSupabaseStorageUrl(data.signedUrl),
      token: data.token,
    });
  } catch (e) {
    console.error('POST /api/text-bucketing/upload-url:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unexpected server error' },
      { status: 500 },
    );
  }
}
