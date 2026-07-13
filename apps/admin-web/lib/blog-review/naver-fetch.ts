/**
 * 네이버 블로그 본문 가져오기(외부 글 검수용). 서버에서만 호출.
 * 네이버는 본문을 iframe(PostView) 안에 렌더하므로, 모바일 URL(m.blog.naver.com/{id}/{logNo})을
 * 받아 SmartEditor ONE(.se-main-container) 또는 레거시(#postViewArea)에서 텍스트·이미지수를 뽑는다.
 * 실패 시 caller 는 "본문 붙여넣기" 폴백을 안내한다.
 */

export interface NaverPost {
  title: string;
  bodyText: string;
  imageCount: number;
  tags: string[];
  /** 섹션 구분 수 — 네이버는 마크다운 헤딩이 없어 구분선(se-horizontalLine) 수로 센다. */
  headingCount: number;
  sourceUrl: string;
}

/** 다양한 네이버 URL 형태에서 blogId·logNo 를 뽑는다. 실패 시 null. */
export function parseNaverUrl(raw: string): { blogId: string; logNo: string } | null {
  const url = String(raw ?? '').trim();
  if (!url) return null;
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    if (!/(^|\.)blog\.naver\.com$/.test(u.hostname)) return null;
    // 쿼리형: /PostView.naver?blogId=..&logNo=..
    const qBlog = u.searchParams.get('blogId');
    const qLog = u.searchParams.get('logNo');
    if (qBlog && qLog) return { blogId: qBlog, logNo: qLog };
    // 경로형: /{blogId}/{logNo}
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length >= 2 && /^\d+$/.test(parts[1])) return { blogId: parts[0], logNo: parts[1] };
    return null;
  } catch {
    return null;
  }
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    // 블록 경계(문단·줄바꿈·리스트)는 개행으로 보존한 뒤 나머지 태그 제거.
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/blockquote)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[​‌‍﻿]/g, '') // zero-width space·BOM(네이버 빈 문단에 자주 들어감)
    .replace(/[^\S\n]+/g, ' ') // 가로 공백(스페이스·탭·nbsp) → 1칸, 개행은 보존
    .replace(/ *\n */g, '\n') // 개행 주변 공백 제거
    .replace(/\n{2,}/g, '\n\n') // 빈 줄 여러 개 → 한 줄만
    .trim();
}

/** 여는 태그 위치부터 균형 잡힌 닫는 </div> 까지 잘라낸다(중첩 div 고려). 실패 시 null. */
function sliceContainer(html: string, openIdx: number): string | null {
  const tagRe = /<\/?div\b[^>]*>/gi;
  tagRe.lastIndex = openIdx;
  let depth = 0;
  let m: RegExpExecArray | null;
  const start = html.indexOf('>', openIdx);
  if (start === -1) return null;
  depth = 1;
  while ((m = tagRe.exec(html))) {
    if (m.index <= openIdx) continue;
    if (/^<div/i.test(m[0])) depth += 1;
    else {
      depth -= 1;
      if (depth === 0) return html.slice(start + 1, m.index);
    }
  }
  return null;
}

function extractContainer(html: string): string | null {
  const seOpen = html.search(/<div[^>]*class="[^"]*se-main-container[^"]*"[^>]*>/i);
  if (seOpen !== -1) return sliceContainer(html, seOpen);
  const legacyOpen = html.search(/<div[^>]*id="postViewArea"[^>]*>/i);
  if (legacyOpen !== -1) return sliceContainer(html, legacyOpen);
  return null;
}

function extractTitle(html: string): string {
  const og = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]*)"/i);
  if (og?.[1]) return og[1].trim();
  const t = html.match(/<title>([^<]*)<\/title>/i);
  return t?.[1]?.replace(/\s*:\s*네이버\s*블로그\s*$/i, '').trim() ?? '';
}

function decodeTag(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' ')).trim();
  } catch {
    return s.trim();
  }
}

/**
 * 게시글 태그 추출(여러 레이아웃 대비 다중 전략).
 *  1) 태그 링크의 tagName= 쿼리(가장 안정적)
 *  2) 해시태그 표기 ">#텍스트<" (태그 영역 렌더)
 *  3) <meta name="keywords">
 */
export function extractTags(html: string): string[] {
  const tags = new Set<string>();
  let m: RegExpExecArray | null;

  const reTagName = /[?&]tagName=([^&"'\\ >]+)/gi;
  while ((m = reTagName.exec(html))) {
    const t = decodeTag(m[1]);
    if (t) tags.add(t);
  }

  const reHash = />\s*#\s*([^<#\s][^<]{0,38})</g;
  while ((m = reHash.exec(html))) {
    const t = m[1].trim();
    if (t) tags.add(t);
  }

  const meta = html.match(/<meta[^>]*name="keywords"[^>]*content="([^"]*)"/i);
  if (meta?.[1]) {
    for (const part of meta[1].split(',')) {
      const t = part.trim();
      if (t) tags.add(t);
    }
  }

  return [...tags].filter((t) => t && t.length <= 40).slice(0, 30);
}

/** 본문 컨테이너 내 콘텐츠 이미지 수(se-image 모듈 또는 <img> 태그 기준). */
function countImages(containerHtml: string): number {
  const seImg = (containerHtml.match(/class="[^"]*se-image[^"]*"/gi) ?? []).length;
  if (seImg > 0) return seImg;
  return (containerHtml.match(/<img\b/gi) ?? []).length;
}

/** 네이버 블로그 글을 가져와 검수 입력으로 정규화. 실패 시 throw. */
export async function fetchNaverPost(rawUrl: string): Promise<NaverPost> {
  const ids = parseNaverUrl(rawUrl);
  if (!ids) throw new Error('네이버 블로그 링크 형식을 인식하지 못했습니다. 본문을 직접 붙여넣어 주세요.');

  const mobileUrl = `https://m.blog.naver.com/${ids.blogId}/${ids.logNo}`;
  const res = await fetch(mobileUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'Accept-Language': 'ko-KR,ko;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`네이버 응답 오류(${res.status}). 본문을 직접 붙여넣어 주세요.`);

  const html = await res.text();
  const container = extractContainer(html);
  if (!container) throw new Error('본문을 추출하지 못했습니다(비공개·형식 변경 가능). 본문을 직접 붙여넣어 주세요.');

  // 본문은 화면에 그대로 표시하므로 깨끗하게 둔다. 섹션 구분은 구분선(se-horizontalLine) 수로 별도 카운트.
  const bodyText = stripTags(container);
  const headingCount = (container.match(/se-section-horizontalLine/gi) ?? []).length;
  if (bodyText.length < 30) throw new Error('본문이 너무 짧거나 추출에 실패했습니다. 본문을 직접 붙여넣어 주세요.');

  return {
    title: extractTitle(html),
    bodyText,
    imageCount: countImages(container),
    tags: extractTags(html),
    headingCount,
    sourceUrl: mobileUrl,
  };
}
