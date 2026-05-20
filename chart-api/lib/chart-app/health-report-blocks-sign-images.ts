import type { HealthSystemsReportBlock } from '@/lib/chart-app/health-systems-demo-blocks';
import { signCaseImageStoragePaths } from '@/lib/chart-app/image-case-signing';

/**
 * Supabase Storage signed/public URL에서 object key를 추출한다.
 * 형식: /storage/v1/object/(sign|public)/{bucket}/{key}
 * 다른 도메인 URL이면 null 반환 → 재서명 시도 안 함.
 */
function extractSupabaseObjectKey(src: string): string | null {
  try {
    const u = new URL(src);
    const m = u.pathname.match(/^\/storage\/v1\/object\/(?:sign|public)\/[^/]+\/(.+)$/);
    if (!m) return null;
    // key 부분에 query string이 붙어 있을 수 있으므로 제거
    return decodeURIComponent(m[1].split('?')[0]);
  } catch {
    return null;
  }
}

function collectSlots(blocks: HealthSystemsReportBlock[]): Array<{ src: string; rawKey: string | null }> {
  const result: Array<{ src: string; rawKey: string | null }> = [];
  for (const b of blocks) {
    if (b.variant === 'images' || b.variant === 'images4' || b.variant === 'imagesGrid2x3' || b.variant === 'imagesGrid3x3') {
      for (const slot of b.images) {
        if (!slot.src || slot.src.startsWith('blob:') || slot.src.startsWith('data:')) continue;
        if (!slot.src.startsWith('http')) {
          result.push({ src: slot.src, rawKey: slot.src });
        } else {
          // Supabase signed/public URL → extract key so we can re-sign fresh
          result.push({ src: slot.src, rawKey: extractSupabaseObjectKey(slot.src) });
        }
      }
    }
  }
  return result;
}

export async function signImageSlotsInBlocks(blocks: HealthSystemsReportBlock[]): Promise<void> {
  const slots = collectSlots(blocks);
  const keysToSign = [...new Set(slots.map((s) => s.rawKey).filter((k): k is string => Boolean(k)))];
  if (keysToSign.length === 0) return;

  const signed = await signCaseImageStoragePaths(keysToSign);
  if (signed.size === 0) return;

  for (const b of blocks) {
    if (b.variant === 'images' || b.variant === 'images4' || b.variant === 'imagesGrid2x3' || b.variant === 'imagesGrid3x3') {
      for (const slot of b.images) {
        if (!slot.src || slot.src.startsWith('blob:') || slot.src.startsWith('data:')) continue;
        const rawKey = slot.src.startsWith('http')
          ? extractSupabaseObjectKey(slot.src)
          : slot.src;
        if (!rawKey) continue;
        const url = signed.get(rawKey);
        if (url) slot.src = url;
      }
    }
  }
}
