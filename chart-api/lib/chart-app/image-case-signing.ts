import { getChartAppSupabaseService } from '@/lib/chart-app/supabase-service';
import { getCaseImageBucket } from '@/lib/chart-app/storage-config';

const PREVIEW_TTL_SEC = 60 * 60 * 24 * 7;

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
        const { data, error } = await supabase.storage.from(bucket).createSignedUrl(p, PREVIEW_TTL_SEC);
        if (!error && data?.signedUrl) { out.set(p, data.signedUrl); return; }
      }
    }),
  );
  return out;
}

