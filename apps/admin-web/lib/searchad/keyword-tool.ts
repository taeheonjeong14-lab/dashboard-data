import { getAdminWebPgPool } from '@/lib/db';
import { resolveSearchadSecret, signSearchadHeaders, searchadBaseUrl } from './client';

// 네이버 검색광고 키워드도구(/keywordstool) 공용 로직.
// 온디맨드 조회(naver-keyword 라우트)·월간 크론·수동 갱신이 모두 공유한다.

export type KeywordToolCreds = { customerId: string; apiLicense: string; secret: string; label: string };

/** 키워드 매칭·저장용 정규화(네이버는 키워드 내부 공백을 제거해야 함). */
export function normalizeKeyword(s: string): string {
  return String(s ?? '').replace(/\s+/g, '').trim();
}

/** "< 10" 같은 문자열 대응. 숫자면 그대로. */
export function parseCount(v: unknown): { num: number; under10: boolean } {
  if (typeof v === 'number' && Number.isFinite(v)) return { num: v, under10: false };
  const s = String(v ?? '').trim();
  if (!s) return { num: 0, under10: false };
  if (s.includes('<')) return { num: 10, under10: true }; // "< 10"
  const n = Number(s.replace(/[,\s]/g, ''));
  return { num: Number.isFinite(n) ? n : 0, under10: false };
}

/** env 공용 계정(있으면 우선) → 없으면 검색광고 활성 병원 중 이름순 첫 계정. 검색량은 계정 무관. */
export async function pickKeywordToolCreds(): Promise<KeywordToolCreds | null> {
  const envCust = (process.env.SEARCHAD_KEYWORDTOOL_CUSTOMER_ID || '').trim();
  const envLic = (process.env.SEARCHAD_KEYWORDTOOL_API_LICENSE || '').trim();
  const envSec = (process.env.SEARCHAD_KEYWORDTOOL_SECRET_KEY || '').trim();
  if (envCust && envLic && envSec) {
    return { customerId: envCust, apiLicense: envLic, secret: envSec, label: '공용 계정' };
  }

  const { rows } = await getAdminWebPgPool().query<{
    name: string | null;
    searchad_customer_id: string | null;
    searchad_api_license: string | null;
    searchad_secret_key_encrypted: string | null;
  }>(
    `select name, searchad_customer_id, searchad_api_license, searchad_secret_key_encrypted
       from core.hospitals
      where searchad_is_active = true
        and searchad_customer_id is not null
        and searchad_api_license is not null
        and searchad_secret_key_encrypted is not null
      order by name asc
      limit 1`,
  );
  const row = rows[0];
  if (!row) return null;
  const customerId = String(row.searchad_customer_id ?? '').trim();
  const apiLicense = String(row.searchad_api_license ?? '').trim();
  const secretEnc = String(row.searchad_secret_key_encrypted ?? '').trim();
  if (!customerId || !apiLicense || !secretEnc) return null;
  return { customerId, apiLicense, secret: secretEnc, label: String(row.name ?? '병원 계정') };
}

export class KeywordToolError extends Error {
  status: number;
  detail: string;
  constructor(message: string, status: number, detail = '') {
    super(message);
    this.name = 'KeywordToolError';
    this.status = status;
    this.detail = detail;
  }
}

/** 저수준 호출: hintKeywords(최대 5개)로 keywordList 원본 반환. 실패 시 KeywordToolError. */
export async function callKeywordTool(
  hints: string[],
  creds: KeywordToolCreds,
): Promise<Array<Record<string, unknown>>> {
  const secretKey = resolveSearchadSecret(creds.secret);
  const uri = '/keywordstool'; // 서명은 경로만(쿼리스트링 제외)
  const qs = new URLSearchParams({ hintKeywords: hints.join(','), showDetail: '1' });
  const res = await fetch(`${searchadBaseUrl()}${uri}?${qs.toString()}`, {
    method: 'GET',
    headers: signSearchadHeaders('GET', uri, creds.apiLicense, secretKey, creds.customerId),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    const msg =
      res.status === 429
        ? '네이버 호출 한도 초과(잠시 후 다시 시도)'
        : `네이버 키워드도구 조회 실패 (HTTP ${res.status})`;
    throw new KeywordToolError(msg, res.status, t.slice(0, 300));
  }
  const json = (await res.json()) as { keywordList?: Array<Record<string, unknown>> };
  return Array.isArray(json.keywordList) ? json.keywordList : [];
}

export type KeywordVolume = {
  keyword: string; // 정규화된 키
  pcCount: number;
  mobileCount: number;
  totalCount: number;
  compIdx: string;
  under10: boolean;
};

/**
 * 요청한 키워드들의 검색량만 반환(연관 키워드는 무시).
 * 중복 제거 후 5개씩 묶어 호출하며 429 완화를 위해 청크 사이에 딜레이.
 * 반환: 정규화 키워드 → 검색량 Map.
 */
export async function fetchKeywordVolumes(
  keywords: string[],
  creds: KeywordToolCreds,
  opts: { delayMs?: number } = {},
): Promise<Map<string, KeywordVolume>> {
  const uniq = [...new Set(keywords.map(normalizeKeyword).filter(Boolean))];
  const out = new Map<string, KeywordVolume>();
  const delay = opts.delayMs ?? 300;

  for (let i = 0; i < uniq.length; i += 5) {
    const chunk = uniq.slice(i, i + 5);
    const list = await callKeywordTool(chunk, creds);
    const want = new Set(chunk.map((c) => c.toUpperCase()));
    for (const k of list) {
      const kw = normalizeKeyword(String(k.relKeyword ?? ''));
      if (!kw || !want.has(kw.toUpperCase())) continue; // 요청한 키워드만
      const pc = parseCount(k.monthlyPcQcCnt);
      const mobile = parseCount(k.monthlyMobileQcCnt);
      out.set(kw, {
        keyword: kw,
        pcCount: pc.num,
        mobileCount: mobile.num,
        totalCount: pc.num + mobile.num,
        compIdx: String(k.compIdx ?? '').trim(),
        under10: pc.under10 || mobile.under10,
      });
    }
    if (i + 5 < uniq.length) await new Promise((r) => setTimeout(r, delay));
  }
  return out;
}

/** 'YYYY-MM' (KST 기준 현재 월). */
export function currentYearMonth(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 3600 * 1000); // UTC→KST
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** 검색량 Map을 analytics.naver_keyword_volume 에 월별 upsert. */
export async function upsertKeywordVolumes(
  volumes: Iterable<KeywordVolume>,
  yearMonth: string,
): Promise<number> {
  const pool = getAdminWebPgPool();
  let n = 0;
  for (const v of volumes) {
    await pool.query(
      `insert into analytics.naver_keyword_volume
         (keyword, year_month, pc_count, mobile_count, total_count, comp_idx, under10, checked_at)
       values ($1, $2, $3, $4, $5, $6, $7, now())
       on conflict (keyword, year_month) do update set
         pc_count = excluded.pc_count,
         mobile_count = excluded.mobile_count,
         total_count = excluded.total_count,
         comp_idx = excluded.comp_idx,
         under10 = excluded.under10,
         checked_at = now()`,
      [v.keyword, yearMonth, v.pcCount, v.mobileCount, v.totalCount, v.compIdx, v.under10],
    );
    n += 1;
  }
  return n;
}

export type StoredVolume = KeywordVolume & { yearMonth: string; checkedAt: string };

/** 주어진 키워드들의 최신 월 검색량을 DB에서 조회. 반환: 정규화 키워드 → StoredVolume. */
export async function readLatestVolumes(keywords: string[]): Promise<Map<string, StoredVolume>> {
  const uniq = [...new Set(keywords.map(normalizeKeyword).filter(Boolean))];
  const out = new Map<string, StoredVolume>();
  if (uniq.length === 0) return out;
  const { rows } = await getAdminWebPgPool().query<{
    keyword: string;
    year_month: string;
    pc_count: number;
    mobile_count: number;
    total_count: number;
    comp_idx: string;
    under10: boolean;
    checked_at: string;
  }>(
    `select distinct on (keyword)
        keyword, year_month, pc_count, mobile_count, total_count, comp_idx, under10, checked_at
       from analytics.naver_keyword_volume
      where keyword = any($1)
      order by keyword, year_month desc`,
    [uniq],
  );
  for (const r of rows) {
    out.set(r.keyword, {
      keyword: r.keyword,
      pcCount: Number(r.pc_count) || 0,
      mobileCount: Number(r.mobile_count) || 0,
      totalCount: Number(r.total_count) || 0,
      compIdx: r.comp_idx || '',
      under10: !!r.under10,
      yearMonth: r.year_month,
      checkedAt: r.checked_at,
    });
  }
  return out;
}
