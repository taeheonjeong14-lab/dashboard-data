import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import {
  pickKeywordToolCreds,
  fetchKeywordVolumes,
  upsertKeywordVolumes,
  readLatestVolumes,
  currentYearMonth,
  normalizeKeyword,
  KeywordToolError,
  type StoredVolume,
} from '@/lib/searchad/keyword-tool';

export const maxDuration = 60;

// 병원 관리 > 키워드 탭에서 각 키워드의 저장된 검색량을 표시/갱신.
//   GET  ?keywords=a,b,c          → DB의 최신 월 검색량 조회(네이버 호출 없음)
//   POST { keywords: [...] }       → 지금 네이버 조회 후 이번 달 저장하고 반환(수동 갱신)

function parseKeywords(input: string | string[] | undefined | null): string[] {
  const raw = Array.isArray(input) ? input.join(',') : String(input ?? '');
  return [...new Set(raw.split(/[,\n]/).map(normalizeKeyword).filter(Boolean))];
}

function serialize(map: Map<string, StoredVolume>) {
  const out: Record<string, StoredVolume> = {};
  for (const [k, v] of map) out[k] = v;
  return out;
}

export async function GET(request: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const keywords = parseKeywords(url.searchParams.get('keywords'));
  if (keywords.length === 0) return NextResponse.json({ volumes: {} });

  try {
    const map = await readLatestVolumes(keywords);
    return NextResponse.json({ volumes: serialize(map) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '조회 실패' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  let body: { keywords?: string | string[] } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // body 없음
  }
  const keywords = parseKeywords(body.keywords);
  if (keywords.length === 0) return NextResponse.json({ error: '키워드가 없습니다.' }, { status: 400 });

  const creds = await pickKeywordToolCreds();
  if (!creds) {
    return NextResponse.json(
      { error: '검색광고 연동된 계정이 없습니다. SearchAd 자격증명을 먼저 설정하세요.' },
      { status: 400 },
    );
  }

  try {
    const month = currentYearMonth();
    // 청크마다 즉시 저장(진행분 보존). 429 등은 내부에서 재시도·건너뜀.
    const { volumes, failed } = await fetchKeywordVolumes(keywords, creds, {
      onBatch: async (batch) => { await upsertKeywordVolumes(batch, month); },
    });
    // 저장된 최신값을 다시 읽어 StoredVolume(월·시각 포함) 형태로 반환.
    const map = await readLatestVolumes(keywords);
    return NextResponse.json({
      account: creds.label,
      month,
      updated: volumes.size,
      failed: failed.length,
      volumes: serialize(map),
    });
  } catch (e) {
    if (e instanceof KeywordToolError) {
      return NextResponse.json({ error: e.message, detail: e.detail }, { status: 502 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : '갱신 실패' }, { status: 500 });
  }
}
