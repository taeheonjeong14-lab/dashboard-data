'use client';

import { useMemo, useState } from 'react';
import type { BlogPeriodDayRow, BlogRankDailyRow } from '@/lib/admin-stats/queries-server';

const SECTIONS = [
  { key: 'blog_rank_tab', label: '블로그탭' },
  { key: 'blog_rank_integrated', label: '통합검색' },
  { key: 'blog_rank_pet_popular', label: '반려동물 인기글' },
  { key: 'blog_rank_general', label: '일반검색' },
] as const;
type SectionKey = (typeof SECTIONS)[number]['key'];

const RANGE_OPTIONS: { v: number; label: string }[] = [
  { v: 14, label: '14일' },
  { v: 30, label: '30일' },
  { v: 60, label: '60일' },
  { v: 90, label: '90일' },
  { v: 0, label: '전체' },
];

function mmdd(dateKey: string): string {
  return dateKey.length >= 10 ? dateKey.slice(5) : dateKey;
}

/** 전 컬럼 대비 변화에 따른 셀 스타일. higherIsBetter=true(지표), false(순위는 숫자 작을수록 좋음). */
function trendStyle(
  cur: number | null,
  prev: number | null,
  higherIsBetter: boolean,
): { background?: string; color?: string; fontWeight?: number } {
  if (cur == null || prev == null || cur === prev) return {};
  const better = higherIsBetter ? cur > prev : cur < prev;
  return better
    ? { background: '#dcfce7', color: '#166534', fontWeight: 600 }
    : { background: '#fee2e2', color: '#b91c1c', fontWeight: 600 };
}

const headCell =
  'sticky top-0 z-10 whitespace-nowrap border-b border-slate-200 bg-white px-1.5 py-1.5 text-center font-medium text-slate-500';
const firstCol =
  'sticky left-0 z-20 whitespace-nowrap border-b border-slate-100 bg-white px-2 py-1 font-semibold text-slate-700';

/** 단일 시계열(조회수/순방문자) — 1행, 컬럼=날짜. */
function SeriesTrendTable({
  label,
  dates,
  valueByDate,
  suffix,
}: {
  label: string;
  dates: string[];
  valueByDate: Map<string, number | null>;
  suffix: string;
}) {
  return (
    <div>
      <h3 className="mb-1.5 text-sm font-semibold text-slate-700">{label}</h3>
      <div className="overflow-auto rounded border border-slate-200" style={{ maxHeight: '24vh' }}>
        <table className="border-collapse text-xs">
          <thead>
            <tr>
              <th className={`${headCell} sticky left-0 z-30 text-left`}>날짜</th>
              {dates.map((d) => (
                <th key={d} className={headCell} style={{ minWidth: 52 }}>
                  {mmdd(d)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={firstCol}>{label}</td>
              {dates.map((d, i) => {
                const cur = valueByDate.get(d) ?? null;
                const prev = i > 0 ? valueByDate.get(dates[i - 1]) ?? null : null;
                const st = trendStyle(cur, prev, true);
                return (
                  <td
                    key={d}
                    className="border-b border-slate-100 px-1.5 py-1 text-center tabular-nums text-slate-700"
                    style={st}
                  >
                    {cur == null ? <span className="text-slate-300">—</span> : cur.toLocaleString('ko-KR')}
                    {cur == null ? '' : suffix}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function BlogTrendTables({
  period,
  daily,
}: {
  period: BlogPeriodDayRow[];
  daily: BlogRankDailyRow[];
}) {
  const [rangeDays, setRangeDays] = useState<number>(30);
  const [section, setSection] = useState<SectionKey>('blog_rank_tab');
  const [kw, setKw] = useState('');

  const sliceLast = (arr: string[]) => (rangeDays === 0 ? arr : arr.slice(-rangeDays));

  // --- 지표(조회수/순방문자): 일별 행 ---
  const dayRows = useMemo(() => period.filter((r) => r.periodType === 'day'), [period]);
  const metricDates = useMemo(
    () => sliceLast(Array.from(new Set(dayRows.map((r) => r.dateKey))).sort()),
    [dayRows, rangeDays],
  );
  const viewsByDate = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const r of dayRows) m.set(r.dateKey, r.views);
    return m;
  }, [dayRows]);
  const visitorsByDate = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const r of dayRows) m.set(r.dateKey, r.uniqueVisitors);
    return m;
  }, [dayRows]);

  // --- 순위: 키워드 × 날짜 ---
  const rankDates = useMemo(
    () => sliceLast(Array.from(new Set(daily.map((r) => r.dateKey))).sort()),
    [daily, rangeDays],
  );
  const keywords = useMemo(() => {
    const q = kw.trim().toLowerCase();
    const set = Array.from(new Set(daily.map((r) => r.keyword)));
    return (q ? set.filter((k) => k.toLowerCase().includes(q)) : set).sort();
  }, [daily, kw]);
  const rankMap = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const r of daily) m.set(`${r.keyword}|${r.dateKey}`, (r[section] as number | null) ?? null);
    return m;
  }, [daily, section]);
  const getRank = (k: string, d: string) => rankMap.get(`${k}|${d}`) ?? null;

  const ctrlCls = 'rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 focus:outline-none';

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-800">변화 추이</h2>
        <select className={ctrlCls} value={rangeDays} onChange={(e) => setRangeDays(Number(e.target.value))}>
          {RANGE_OPTIONS.map((o) => (
            <option key={o.v} value={o.v}>최근 {o.label}</option>
          ))}
        </select>
      </div>
      <p className="mt-1 text-xs text-slate-400">
        전 수집 대비 <span style={{ color: '#166534' }}>좋아지면 초록</span> · <span style={{ color: '#b91c1c' }}>나빠지면 빨강</span> · 변화 없으면 무색
      </p>

      <div className="mt-3 flex flex-col gap-4">
        <SeriesTrendTable label="블로그 조회수" dates={metricDates} valueByDate={viewsByDate} suffix="" />
        <SeriesTrendTable label="블로그 순방문자수" dates={metricDates} valueByDate={visitorsByDate} suffix="" />

        {/* 키워드별 순위 */}
        <div>
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-700">키워드별 순위</h3>
            <select className={ctrlCls} value={section} onChange={(e) => setSection(e.target.value as SectionKey)}>
              {SECTIONS.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
            <input
              className={ctrlCls}
              type="search"
              value={kw}
              placeholder="키워드 필터"
              onChange={(e) => setKw(e.target.value)}
            />
            <span className="text-xs text-slate-400">키워드 {keywords.length}개 · 수집일 {rankDates.length}개</span>
          </div>
          <div className="overflow-auto rounded border border-slate-200" style={{ maxHeight: '46vh' }}>
            <table className="border-collapse text-xs">
              <thead>
                <tr>
                  <th className={`${headCell} sticky left-0 z-30 text-left`}>키워드 \ 날짜</th>
                  {rankDates.map((d) => (
                    <th key={d} className={headCell} style={{ minWidth: 40 }}>{mmdd(d)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {keywords.length === 0 ? (
                  <tr>
                    <td className="px-2 py-2 text-slate-400" colSpan={rankDates.length + 1}>
                      순위 데이터가 없습니다.
                    </td>
                  </tr>
                ) : (
                  keywords.map((k) => (
                    <tr key={k}>
                      <td className={firstCol}>{k}</td>
                      {rankDates.map((d, i) => {
                        const cur = getRank(k, d);
                        const prev = i > 0 ? getRank(k, rankDates[i - 1]) : null;
                        const st = trendStyle(cur, prev, false);
                        return (
                          <td
                            key={d}
                            className="border-b border-slate-100 px-1.5 py-1 text-center tabular-nums text-slate-700"
                            style={st}
                          >
                            {cur ?? <span className="text-slate-300">—</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
