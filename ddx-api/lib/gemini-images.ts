/**
 * 이미지 URL을 fetch해서 Gemini API용 inline_data parts로 변환.
 * - 최대 개수·용량 제한으로 요청 크기 관리
 */

const MAX_IMAGES = 5;
const MAX_BYTES_PER_IMAGE = 2 * 1024 * 1024; // 2MB
const FETCH_TIMEOUT_MS = 10000;

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

function mimeFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname;
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    return MIME_BY_EXT[ext] ?? 'image/jpeg';
  } catch {
    return 'image/jpeg';
  }
}

function mimeFromContentType(ct: string | null): string {
  if (!ct) return 'image/jpeg';
  const base = ct.split(';')[0].trim().toLowerCase();
  if (base.startsWith('image/')) return base;
  return 'image/jpeg';
}

export type GeminiImagePart = {
  inlineData: {
    mimeType: string;
    data: string;
  };
};

/**
 * URL 목록을 fetch해서 base64로 변환 후, Gemini parts 배열로 반환.
 * 실패한 URL은 건너뛴다.
 */
export async function fetchImagePartsForGemini(
  urls: string[],
  options?: { maxImages?: number }
): Promise<GeminiImagePart[]> {
  const max = options?.maxImages ?? MAX_IMAGES;
  const toFetch = urls.slice(0, max);
  const parts: GeminiImagePart[] = [];

  for (const url of toFetch) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'image/*' },
      });
      clearTimeout(timeoutId);
      if (!res.ok) continue;
      const contentType = res.headers.get('content-type');
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_BYTES_PER_IMAGE) continue;
      const base64 = Buffer.from(buf).toString('base64');
      const mimeType = mimeFromContentType(contentType) || mimeFromUrl(url);
      parts.push({
        inlineData: { mimeType, data: base64 },
      });
    } catch {
      // skip failed image
    }
  }
  return parts;
}
