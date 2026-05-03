const URL_REGEX = /^https?:\/\//i;

function extractUrlFromValue(v: unknown): string[] {
  if (typeof v === 'string' && URL_REGEX.test(v)) return [v];
  if (Array.isArray(v)) {
    const urls: string[] = [];
    for (const item of v) {
      urls.push(...extractUrlFromValue(item));
    }
    return urls;
  }
  if (v && typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    if (typeof obj.url === 'string' && URL_REGEX.test(obj.url)) return [obj.url];
    if (typeof obj.value === 'string' && URL_REGEX.test(obj.value)) return [obj.value];
    if (typeof obj.fileUrl === 'string' && URL_REGEX.test(obj.fileUrl)) return [obj.fileUrl];
    if (obj.raw && typeof (obj.raw as Record<string, unknown>).url === 'string') {
      const u = (obj.raw as { url?: string }).url;
      if (u && URL_REGEX.test(u)) return [u];
    }
  }
  return [];
}

/**
 * Tally 폼 웹훅으로 저장된 tallyData에서 이미지 URL 목록 추출.
 * value/answer가 URL 문자열, URL 배열, 또는 { url/value/fileUrl } 객체인 경우 모두 처리.
 */
export function getImageUrlsFromTallyData(tallyData: unknown): { label: string; url: string }[] {
  const fields = (tallyData as { data?: { fields?: unknown[] } })?.data?.fields;
  if (!Array.isArray(fields)) return [];
  const out: { label: string; url: string }[] = [];
  for (const f of fields) {
    if (!f || typeof f !== 'object') continue;
    const obj = f as Record<string, unknown>;
    const label =
      (typeof obj.label === 'string' && obj.label) ||
      (typeof obj.title === 'string' && obj.title) ||
      '첨부';
    const v = obj.value ?? obj.answer;
    const urls = extractUrlFromValue(v);
    for (const url of urls) {
      out.push({ label, url });
    }
  }
  return out;
}
