import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { readLatestVolumes, normalizeKeyword } from '@/lib/searchad/keyword-tool';

export const dynamic = 'force-dynamic';

type KeywordOption = {
  keyword: string;
  lastUsedAt: string | null;
  /** 가장 최근 수집에서 이 키워드의 최상위 블로그 순위(작을수록 상위). 노출 없으면 null. */
  rank: number | null;
  /** 위 순위가 나온 네이버 섹션. */
  rankSection: string | null;
  /** 가장 최근 집계된 월간 네이버 검색량(PC+모바일). */
  searchVolume: number | null;
};

const RANK_SECTION_LABEL: Record<string, string> = {
  blog_rank_integrated: '통합',
  blog_rank_general: '블로그',
  blog_rank_tab: '블로그탭',
  blog_rank_pet_popular: '펫인기',
};
function rankSectionLabel(metricKey: string, section: string): string {
  return RANK_SECTION_LABEL[metricKey] || section || '순위';
}

// GET — 병원별 블로그 키워드 목록 { [hospitalId]: { keyword, lastUsedAt }[] }.
//  · keyword: '병원 관리 설정 > 키워드'의 블로그 키워드(analytics_blog_keyword_targets).
//  · lastUsedAt: 그 키워드가 '블로그 저장' 작업에 배정된 것 중 마지막 마감일(work_requests.due_date).
//    work_requests 는 run_id 만 가지므로 parse_runs 로 병원을 연결해 병원별로 집계한다(DB 변경 불필요).
export async function GET() {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;
  try {
    const sb = createServiceRoleClient();

    // 1) 병원별 활성 블로그 키워드.
    const { data: kwRows, error: kwErr } = await sb
      .schema('analytics')
      .from('analytics_blog_keyword_targets')
      .select('hospital_id, keyword, is_active')
      .eq('is_active', true);
    if (kwErr) throw new Error(kwErr.message);

    const listByHospital = new Map<string, string[]>();
    for (const r of kwRows ?? []) {
      const row = r as { hospital_id?: unknown; keyword?: unknown };
      const hid = String(row.hospital_id ?? '').trim();
      const kw = String(row.keyword ?? '').trim();
      if (!hid || !kw) continue;
      const list = listByHospital.get(hid) ?? [];
      if (!list.includes(kw)) list.push(kw);
      listByHospital.set(hid, list);
    }

    // 2) blog_save 로 배정된 이력(run_id, keyword, due_date). 마감일 없는 건은 집계 제외.
    const { data: reqRows, error: reqErr } = await sb
      .schema('health_report')
      .from('work_requests')
      .select('run_id, keyword, keyword2, due_date')
      .eq('board', 'blog_save')
      .not('due_date', 'is', null);
    if (reqErr) throw new Error(reqErr.message);

    // 3) run_id → hospital_id 매핑(청크 조회).
    const runIds = [...new Set((reqRows ?? []).map((r) => String((r as { run_id?: unknown }).run_id ?? '').trim()).filter(Boolean))];
    const hospitalByRun = new Map<string, string>();
    const CHUNK = 200;
    for (let i = 0; i < runIds.length; i += CHUNK) {
      const slice = runIds.slice(i, i + CHUNK);
      const { data: runs, error: rErr } = await sb
        .schema('chart_pdf')
        .from('parse_runs')
        .select('id, hospital_id')
        .in('id', slice);
      if (rErr) throw new Error(rErr.message);
      for (const r of runs ?? []) {
        const row = r as { id?: unknown; hospital_id?: unknown };
        const id = String(row.id ?? '').trim();
        const hid = String(row.hospital_id ?? '').trim();
        if (id && hid) hospitalByRun.set(id, hid);
      }
    }

    // 4) (hospital_id, keyword) 별 마지막 마감일. due_date 는 'YYYY-MM-DD' 라 문자열 비교로 최신 판별 가능.
    const lastUsed = new Map<string, string>(); // key: `${hid} ${keyword}`
    for (const r of reqRows ?? []) {
      const row = r as { run_id?: unknown; keyword?: unknown; keyword2?: unknown; due_date?: unknown };
      const hid = hospitalByRun.get(String(row.run_id ?? '').trim());
      const at = String(row.due_date ?? '').trim();
      if (!hid || !at) continue;
      for (const kw of [String(row.keyword ?? '').trim(), String(row.keyword2 ?? '').trim()]) {
        if (!kw) continue;
        const key = `${hid} ${kw}`;
        const prev = lastUsed.get(key);
        if (!prev || at > prev) lastUsed.set(key, at);
      }
    }

    // 5) 병합.
    const rankBest = new Map<string, { rank: number; section: string; date: string }>();
    const since = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
    // 섹션·병원·키워드·날짜별로 행이 많아 기본 1000행 상한에 걸린다 → 페이지네이션으로 전부 읽는다.
    const RANK_PAGE = 1000;
    for (let from = 0; ; from += RANK_PAGE) {
      const { data: rankRows, error: rankErr } = await sb
        .schema('analytics')
        .from('analytics_blog_keyword_ranks')
        .select('hospital_id, keyword, metric_key, section, rank_value, metric_date')
        .gte('metric_date', since)
        .range(from, from + RANK_PAGE - 1);
      if (rankErr) break; // 순위 조회 실패해도 나머지는 내려준다
      const chunk = rankRows ?? [];
      for (const r of chunk) {
        const row = r as { hospital_id?: unknown; keyword?: unknown; metric_key?: unknown; section?: unknown; rank_value?: unknown; metric_date?: unknown };
        const hid = String(row.hospital_id ?? '').trim();
        const kw = String(row.keyword ?? '').trim();
        const rv = Number(row.rank_value);
        const date = String(row.metric_date ?? '').slice(0, 10);
        if (!hid || !kw || !Number.isFinite(rv) || rv <= 0 || !date) continue;
        const key = `${hid} ${kw}`;
        const cur = rankBest.get(key);
        if (!cur || date > cur.date || (date === cur.date && rv < cur.rank)) {
          rankBest.set(key, { rank: rv, section: rankSectionLabel(String(row.metric_key ?? ''), String(row.section ?? '')), date });
        }
      }
      if (chunk.length < RANK_PAGE) break;
    }

    // 검색량은 직접 PG 풀(getAdminWebPgPool)을 쓴다 — 로컬 pooler DNS 실패 등으로 매달리면
    // 화면이 무한 로딩된다. 타임아웃을 걸어 실패해도 나머지(순위·날짜)는 그대로 내려준다.
    const allKeywords = [...new Set([...listByHospital.values()].flat())];
    const volumeByKeyword = new Map<string, number>();
    if (allKeywords.length) {
      try {
        const volumes = await Promise.race([
          readLatestVolumes(allKeywords),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('volume timeout')), 4000)),
        ]);
        // 검색량은 공백을 뗀 정규화 키로 저장/조회된다("동화 동물병원"→"동화동물병원").
        // 타겟 키워드는 공백을 포함하므로, 조회도 정규화 키로 맞춰야 매칭된다(안 그러면 항상 null).
        for (const [kw, v] of volumes) volumeByKeyword.set(normalizeKeyword(kw), v.totalCount);
      } catch { /* 검색량 조회 실패/지연은 무시 — 순위·날짜는 정상 반환 */ }
    }

    const keywords: Record<string, KeywordOption[]> = {};
    for (const [hid, list] of listByHospital) {
      keywords[hid] = list.map((kw) => {
        const best = rankBest.get(`${hid} ${kw}`);
        return {
          keyword: kw,
          lastUsedAt: lastUsed.get(`${hid} ${kw}`) ?? null,
          rank: best?.rank ?? null,
          rankSection: best?.section ?? null,
          searchVolume: volumeByKeyword.get(normalizeKeyword(kw)) ?? null,
        };
      });
    }
    return NextResponse.json({ keywords });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error', keywords: {} }, { status: 500 });
  }
}
