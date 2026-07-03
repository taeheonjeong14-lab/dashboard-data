import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { resolveSearchadSecret, signSearchadHeaders, searchadBaseUrl } from '@/lib/searchad/client';

export const maxDuration = 20;

// POST /api/admin/naver-keyword  { keywords: "강아지 예방접종, 고양이 중성화" }
// 네이버 검색광고 키워드도구(/keywordstool)로 월간 검색량 조회.
// 검색량은 계정과 무관(전국 수치)하므로 검색광고 연동된 병원 계정 하나를 자동 선택해 조회한다.

type Creds = { customerId: string; apiLicense: string; secret: string; label: string };

// env 공용 계정(있으면 우선) → 없으면 검색광고 활성 병원 중 첫 계정.
async function pickCreds(): Promise<Creds | null> {
  const envCust = (process.env.SEARCHAD_KEYWORDTOOL_CUSTOMER_ID || '').trim();
  const envLic = (process.env.SEARCHAD_KEYWORDTOOL_API_LICENSE || '').trim();
  const envSec = (process.env.SEARCHAD_KEYWORDTOOL_SECRET_KEY || '').trim();
  if (envCust && envLic && envSec) {
    return { customerId: envCust, apiLicense: envLic, secret: envSec, label: '공용 계정' };
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .schema('core')
    .from('hospitals')
    .select('name, searchad_customer_id, searchad_api_license, searchad_secret_key_encrypted, searchad_is_active')
    .eq('searchad_is_active', true)
    .not('searchad_customer_id', 'is', null)
    .not('searchad_api_license', 'is', null)
    .not('searchad_secret_key_encrypted', 'is', null)
    .order('name', { ascending: true })
    .limit(1);
  if (error) throw new Error(error.message);
  const row = (data ?? [])[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  const customerId = String(row.searchad_customer_id ?? '').trim();
  const apiLicense = String(row.searchad_api_license ?? '').trim();
  const secretEnc = String(row.searchad_secret_key_encrypted ?? '').trim();
  if (!customerId || !apiLicense || !secretEnc) return null;
  return { customerId, apiLicense, secret: secretEnc, label: String(row.name ?? '병원 계정') };
}

// "< 10" 같은 문자열 대응. 숫자면 그대로.
function parseCount(v: unknown): { num: number; under10: boolean } {
  if (typeof v === 'number' && Number.isFinite(v)) return { num: v, under10: false };
  const s = String(v ?? '').trim();
  if (!s) return { num: 0, under10: false };
  if (s.includes('<')) return { num: 10, under10: true }; // "< 10"
  const n = Number(s.replace(/[,\s]/g, ''));
  return { num: Number.isFinite(n) ? n : 0, under10: false };
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

  // 콤마·줄바꿈·공백 구분 → 키워드 배열. 네이버는 키워드 내부 공백을 제거해야 한다.
  const raw = Array.isArray(body.keywords) ? body.keywords.join(',') : String(body.keywords ?? '');
  const keywords = [...new Set(
    raw
      .split(/[,\n]/)
      .map((k) => k.replace(/\s+/g, '').trim())
      .filter(Boolean),
  )];
  if (keywords.length === 0) {
    return NextResponse.json({ error: '키워드를 입력하세요.' }, { status: 400 });
  }
  // 키워드도구 hintKeywords 는 한 번에 최대 5개.
  const hints = keywords.slice(0, 5);
  const dropped = keywords.length - hints.length;

  let creds: Creds | null;
  try {
    creds = await pickCreds();
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '자격증명 조회 실패' }, { status: 500 });
  }
  if (!creds) {
    return NextResponse.json(
      { error: '검색광고 연동된 계정이 없습니다. 병원 관리에서 SearchAd 자격증명을 먼저 설정하세요.' },
      { status: 400 },
    );
  }

  try {
    const secretKey = resolveSearchadSecret(creds.secret);
    const uri = '/keywordstool'; // 서명은 경로만(쿼리스트링 제외)
    const qs = new URLSearchParams({ hintKeywords: hints.join(','), showDetail: '1' });
    const res = await fetch(`${searchadBaseUrl()}${uri}?${qs.toString()}`, {
      method: 'GET',
      headers: signSearchadHeaders('GET', uri, creds.apiLicense, secretKey, creds.customerId),
    });
    if (!res.ok) {
      const t = await res.text();
      const msg =
        res.status === 429
          ? '네이버 호출 한도 초과(잠시 후 다시 시도)'
          : `네이버 키워드도구 조회 실패 (HTTP ${res.status})`;
      return NextResponse.json({ error: msg, detail: t.slice(0, 300) }, { status: 502 });
    }
    const json = (await res.json()) as { keywordList?: Array<Record<string, unknown>> };
    const list = Array.isArray(json.keywordList) ? json.keywordList : [];

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

    return NextResponse.json({
      account: creds.label,
      queried: hints,
      dropped,
      count: rows.length,
      rows,
    });
  } catch (e) {
    console.error('POST /api/admin/naver-keyword:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
}
