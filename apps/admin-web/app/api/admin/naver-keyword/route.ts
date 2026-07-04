import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import {
  pickKeywordToolCreds,
  callKeywordTool,
  parseCount,
  normalizeKeyword,
  KeywordToolError,
} from '@/lib/searchad/keyword-tool';

export const maxDuration = 20;

// POST /api/admin/naver-keyword  { keywords: "강아지 예방접종, 고양이 중성화" }
// 네이버 검색광고 키워드도구(/keywordstool)로 월간 검색량 + 연관 키워드 온디맨드 조회.
// 검색량은 계정과 무관(전국 수치)하므로 검색광고 연동된 계정 하나를 자동 선택해 조회한다.

export async function POST(request: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  let body: { keywords?: string | string[] } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // body 없음
  }

  // 콤마·줄바꿈·공백 구분 → 키워드 배열(내부 공백 제거).
  const raw = Array.isArray(body.keywords) ? body.keywords.join(',') : String(body.keywords ?? '');
  const keywords = [...new Set(raw.split(/[,\n]/).map(normalizeKeyword).filter(Boolean))];
  if (keywords.length === 0) {
    return NextResponse.json({ error: '키워드를 입력하세요.' }, { status: 400 });
  }
  // 키워드도구 hintKeywords 는 한 번에 최대 5개.
  const hints = keywords.slice(0, 5);
  const dropped = keywords.length - hints.length;

  const creds = await pickKeywordToolCreds().catch((e: unknown) => {
    throw e instanceof Error ? e : new Error('자격증명 조회 실패');
  });
  if (!creds) {
    return NextResponse.json(
      { error: '검색광고 연동된 계정이 없습니다. 병원 관리에서 SearchAd 자격증명을 먼저 설정하세요.' },
      { status: 400 },
    );
  }

  try {
    const list = await callKeywordTool(hints, creds);
    const hintSet = new Set(hints.map((h) => h.toUpperCase()));
    const rows = list.map((k) => {
      const keyword = String(k.relKeyword ?? '').trim();
      const pc = parseCount(k.monthlyPcQcCnt);
      const mobile = parseCount(k.monthlyMobileQcCnt);
      return {
        keyword,
        isHint: hintSet.has(keyword.toUpperCase()),
        pcCount: pc.num,
        pcUnder10: pc.under10,
        mobileCount: mobile.num,
        mobileUnder10: mobile.under10,
        totalCount: pc.num + mobile.num,
        // 경쟁정도(높음/중간/낮음), 평균 노출 광고수, 월평균 클릭수
        compIdx: String(k.compIdx ?? '').trim(),
        plAvgDepth: Number(k.plAvgDepth) || 0,
        avgPcClick: Number(k.monthlyAvePcClkCnt) || 0,
        avgMobileClick: Number(k.monthlyAveMobileClkCnt) || 0,
      };
    });
    // 검색량 많은 순. 입력 키워드는 먼저.
    rows.sort((a, b) => Number(b.isHint) - Number(a.isHint) || b.totalCount - a.totalCount);

    return NextResponse.json({ account: creds.label, queried: hints, dropped, count: rows.length, rows });
  } catch (e) {
    if (e instanceof KeywordToolError) {
      return NextResponse.json({ error: e.message, detail: e.detail }, { status: 502 });
    }
    console.error('POST /api/admin/naver-keyword:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
}
