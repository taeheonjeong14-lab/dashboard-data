import { load } from 'cheerio';

const FETCH_TIMEOUT_MS = 15_000;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export type BlogPreviewJson = {
  success: true;
  url: string;
  title: string | null;
  canonicalUrl: string | null;
  description: string | null;
  imageUrl: string | null;
};

async function fetchWithTimeout(url: string, headers: Record<string, string>): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers,
    });
  } finally {
    clearTimeout(t);
  }
}

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * 네이버 블로그 데스크탑 URL 은 iframe 구조라 외부 og:title 이 블로그 이름밖에 안 담김.
 * 모바일 URL 로 변환하면 og:title 이 글 제목으로 채워져 있어 그대로 사용 가능.
 */
function normalizeForFetch(targetUrl: string): string {
  try {
    const u = new URL(targetUrl);
    if (u.hostname === 'blog.naver.com') {
      u.hostname = 'm.blog.naver.com';
      return u.href;
    }
    return targetUrl;
  } catch {
    return targetUrl;
  }
}

export async function fetchBlogPreview(targetUrl: string): Promise<BlogPreviewJson> {
  const fetchUrl = normalizeForFetch(targetUrl);
  const res = await fetchWithTimeout(fetchUrl, {
    Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
    'User-Agent': DESKTOP_UA,
  });

  // 응답의 url 은 모바일로 변환된 URL 이 될 수 있으나, 사용자에게 노출되는
  // finalUrl 은 원본 데스크탑 URL 을 유지 (canonical 링크 일관성).
  const finalUrl = targetUrl;

  if (!res.ok) {
    throw new Error(`페이지를 불러오지 못했습니다. (${res.status})`);
  }

  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('text/html') && !ct.includes('application/xhtml')) {
    throw new Error('HTML 페이지가 아닙니다.');
  }

  const buf = await res.arrayBuffer();
  const slice = buf.byteLength > MAX_HTML_BYTES ? buf.slice(0, MAX_HTML_BYTES) : buf;
  const html = new TextDecoder('utf-8').decode(slice);

  const $ = load(html);

  const ogTitle = $('meta[property="og:title"]').attr('content')?.trim();
  const twTitle = $('meta[name="twitter:title"]').attr('content')?.trim();
  const titleTag = $('title').first().text().trim();
  const title = ogTitle || twTitle || titleTag || null;

  const ogUrl = $('meta[property="og:url"]').attr('content')?.trim();
  const canonical = $('link[rel="canonical"]').attr('href')?.trim();
  let canonicalUrl: string | null = null;
  try {
    canonicalUrl = canonical ? new URL(canonical, finalUrl).href : ogUrl ? new URL(ogUrl, finalUrl).href : null;
  } catch {
    canonicalUrl = ogUrl ?? canonical ?? null;
  }

  const ogDesc = $('meta[property="og:description"]').attr('content')?.trim();
  const descMeta = $('meta[name="description"]').attr('content')?.trim();
  const description = ogDesc || descMeta || null;

  const ogImage = $('meta[property="og:image"]').attr('content')?.trim();
  let imageUrl: string | null = null;
  if (ogImage) {
    try {
      imageUrl = new URL(ogImage, finalUrl).href;
    } catch {
      imageUrl = ogImage;
    }
  }

  return {
    success: true,
    url: finalUrl,
    title,
    canonicalUrl,
    description,
    imageUrl,
  };
}

export async function fetchImageProxy(targetUrl: string): Promise<{ buffer: Buffer; contentType: string }> {
  const res = await fetchWithTimeout(targetUrl, {
    Accept: 'image/*,*/*;q=0.8',
    'User-Agent': DESKTOP_UA,
  });

  if (!res.ok) {
    throw new Error(`이미지를 불러오지 못했습니다. (${res.status})`);
  }

  const ct = res.headers.get('content-type')?.split(';')[0]?.trim() ?? 'application/octet-stream';
  if (!ct.startsWith('image/') && ct !== 'application/octet-stream') {
    throw new Error('이미지 응답이 아닙니다.');
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_IMAGE_BYTES) {
    throw new Error('이미지가 너무 큽니다.');
  }

  const contentType = ct === 'application/octet-stream' ? 'image/jpeg' : ct;
  return { buffer: buf, contentType };
}
