import { getChartAppSupabaseService } from '@/lib/chart-app/supabase-service';
import { getCaseImageBucket } from '@/lib/chart-app/storage-config';

const PREVIEW_TTL_SEC = 60 * 60 * 24 * 7;
const SIGN_MAX_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function signCaseImageStoragePaths(paths: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(paths.filter((p) => p && !p.startsWith('http') && !p.startsWith('blob:')))];
  const out = new Map<string, string>();
  if (uniq.length === 0) return out;

  const supabase = getChartAppSupabaseService();
  const primaryBucket = getCaseImageBucket();
  // admin-web uploads land in chart-case-images; try both buckets
  const buckets = [...new Set([primaryBucket, 'chart-case-images'])];

  await Promise.all(
    uniq.map(async (p) => {
      for (const bucket of buckets) {
        // 일시적 스토리지 오류로 서명이 누락돼 이미지가 깨지는 것을 막기 위해 버킷별로 재시도한다.
        for (let attempt = 1; attempt <= SIGN_MAX_ATTEMPTS; attempt++) {
          const { data, error } = await supabase.storage.from(bucket).createSignedUrl(p, PREVIEW_TTL_SEC);
          if (!error && data?.signedUrl) {
            out.set(p, data.signedUrl);
            return;
          }
          // 'not found' 류는 다른 버킷에 있는 것이므로 재시도 없이 다음 버킷으로.
          const msg = (error?.message ?? '').toLowerCase();
          if (msg.includes('not found') || msg.includes('not_found')) break;
          if (attempt < SIGN_MAX_ATTEMPTS) await sleep(150 * attempt);
        }
      }
    }),
  );

  // 끝내 서명 못 한 경로는 PDF/미리보기에서 깨지므로 로그로 남겨 추적 가능하게 한다.
  const unsigned = uniq.filter((p) => !out.has(p));
  if (unsigned.length > 0) {
    console.warn(
      `[image-case-signing] failed to sign ${unsigned.length}/${uniq.length} path(s):`,
      unsigned.slice(0, 5),
    );
  }

  return out;
}

