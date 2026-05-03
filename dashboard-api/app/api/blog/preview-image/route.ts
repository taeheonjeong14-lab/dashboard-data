import { NextRequest, NextResponse } from 'next/server';
import { fetchImageProxy } from '@/lib/blog-preview';
import { parseSafeHttpUrl, UnsafeUrlError } from '@/lib/ssrf';

export const runtime = 'nodejs';

/**
 * GET /api/blog/preview-image?url=
 * 외부 이미지 URL을 서버에서 받아 그대로 전달 (CORS·핫링크 완화용).
 */
export async function GET(request: NextRequest) {
  try {
    const raw = new URL(request.url).searchParams.get('url');
    const safeUrl = parseSafeHttpUrl(raw);
    const { buffer, contentType } = await fetchImageProxy(safeUrl.href);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      },
    });
  } catch (e) {
    if (e instanceof UnsafeUrlError) {
      return NextResponse.json({ success: false, error: e.message }, { status: 400 });
    }
    const message = e instanceof Error ? e.message : '이미지 처리 중 오류가 발생했습니다.';
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
