import type { createServiceRoleClient } from '@/lib/supabase/service-role';

/**
 * 경영통계 업로드 임시 스테이징 버킷.
 * Vercel 함수 본문 한도(~4.5MB)·Next 미들웨어 본문 컷(10MB)을 피하려고, 파일은 함수로 직접 보내지 않고
 * 클라이언트가 서명 URL로 Storage 에 직접 올린다. 서버는 경로로 다운로드해 파싱한 뒤 곧바로 삭제하므로
 * 용량이 쌓이지 않는다(임시 통로).
 */
export const STATS_UPLOAD_BUCKET = 'stats-uploads';

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

/** 버킷이 없으면 생성(비공개, 30MB 상한). case-images 와 동일하게 런타임에 보장한다. */
export async function ensureStatsUploadBucket(srvc: ServiceClient): Promise<void> {
  const { data: buckets } = await srvc.storage.listBuckets();
  if (buckets?.some((b) => b.name === STATS_UPLOAD_BUCKET)) return;
  await srvc.storage.createBucket(STATS_UPLOAD_BUCKET, {
    public: false,
    fileSizeLimit: '30mb',
  });
}
