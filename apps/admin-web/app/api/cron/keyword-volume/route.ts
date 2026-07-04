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
    const { rows } = await getAdminWebPgPool().query<{ place_keywords: string[] | null; blog_keywords: string[] | null }>(
      `select place_keywords, blog_keywords from core.hospitals`,
    );
    const all: string[] = [];
    for (const r of rows) {
      if (Array.isArray(r.place_keywords)) all.push(...r.place_keywords);
      if (Array.isArray(r.blog_keywords)) all.push(...r.blog_keywords);
    }
    if (all.length === 0) {
      return NextResponse.json({ ok: true, month: currentYearMonth(), keywords: 0, note: '수집할 키워드 없음' });
    }

    const creds = await pickKeywordToolCreds();
    if (!creds) {
      return NextResponse.json({ error: '검색광고 연동된 계정이 없습니다.' }, { status: 400 });
    }

    const volumes = await fetchKeywordVolumes(all, creds);
    const month = currentYearMonth();
    const saved = await upsertKeywordVolumes(volumes.values(), month);

    return NextResponse.json({ ok: true, month, account: creds.label, keywords: saved });
  } catch (e) {
    if (e instanceof KeywordToolError) {
      console.error('[cron/keyword-volume]', e.message, e.detail);
      return NextResponse.json({ error: e.message, detail: e.detail }, { status: 502 });
    }
    console.error('[cron/keyword-volume]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
