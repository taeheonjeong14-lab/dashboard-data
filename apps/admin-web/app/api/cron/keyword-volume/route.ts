import { NextRequest, NextResponse } from 'next/server';
import { getAdminWebPgPool } from '@/lib/db';
import {
  pickKeywordToolCreds,
  fetchKeywordVolumes,
  upsertKeywordVolumes,
  currentYearMonth,
  KeywordToolError,
} from '@/lib/searchad/keyword-tool';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return (req.headers.get('authorization') || '') === `Bearer ${secret}`;
}

// GET /api/cron/keyword-volume — 매월 1일: 전 병원의 플레이스·블로그 키워드를
// 모아 중복 제거 후 네이버 키워드도구로 월간 검색량을 조회해 이번 달 스냅샷 저장.
// 검색량은 전국 수치라 키워드 단위로 전역 저장한다.
export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    // 키워드는 analytics 타깃 테이블에 저장됨(플레이스/블로그). 활성 키워드만 취합.
    const { rows } = await getAdminWebPgPool().query<{ keyword: string }>(
      `select keyword from analytics.analytics_place_keyword_targets where is_active
       union
       select keyword from analytics.analytics_blog_keyword_targets where is_active`,
    );
    const all = rows.map((r) => r.keyword).filter(Boolean);
    if (all.length === 0) {
      return NextResponse.json({ ok: true, month: currentYearMonth(), keywords: 0, note: '수집할 키워드 없음' });
    }

    const creds = await pickKeywordToolCreds();
    if (!creds) {
      return NextResponse.json({ error: '검색광고 연동된 계정이 없습니다.' }, { status: 400 });
    }

    const month = currentYearMonth();
    // 청크마다 즉시 저장 → 중간에 일부 실패해도 진행분 보존.
    const { volumes, failed } = await fetchKeywordVolumes(all, creds, {
      onBatch: async (batch) => { await upsertKeywordVolumes(batch, month); },
    });

    return NextResponse.json({
      ok: true,
      month,
      account: creds.label,
      keywords: volumes.size,
      failed: failed.length,
    });
  } catch (e) {
    if (e instanceof KeywordToolError) {
      console.error('[cron/keyword-volume]', e.message, e.detail);
      return NextResponse.json({ error: e.message, detail: e.detail }, { status: 502 });
    }
    console.error('[cron/keyword-volume]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
