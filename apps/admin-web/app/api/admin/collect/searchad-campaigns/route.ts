import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { resolveSearchadSecret, signSearchadHeaders, searchadBaseUrl } from '@/lib/searchad/client';

export const maxDuration = 20;

// 병원의 SearchAd 캠페인 목록을 네이버에서 조회한다(선택 수집 UI용).
// 서명·복호화는 @/lib/searchad/client 공유(naver-searchad-main.py 와 동일 방식).

export async function POST(request: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  let body: { hospitalId?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // body 없음
  }
  const hospitalId = (body.hospitalId ?? '').trim();
  if (!hospitalId || !/^[0-9a-f-]{8,36}$/i.test(hospitalId)) {
    return NextResponse.json({ error: '유효하지 않은 hospital_id입니다.' }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { data: row, error } = await supabase
    .schema('core')
    .from('hospitals')
    .select('searchad_customer_id, searchad_api_license, searchad_secret_key_encrypted, searchad_is_active')
    .eq('id', hospitalId)
    .single();
  if (error || !row) {
    return NextResponse.json({ error: '병원을 찾을 수 없습니다.' }, { status: 404 });
  }

  const customerId = String((row as Record<string, unknown>).searchad_customer_id ?? '').trim();
  const apiLicense = String((row as Record<string, unknown>).searchad_api_license ?? '').trim();
  const secretEnc = String((row as Record<string, unknown>).searchad_secret_key_encrypted ?? '').trim();
  if (!(row as Record<string, unknown>).searchad_is_active || !customerId || !apiLicense || !secretEnc) {
    return NextResponse.json({ error: '이 병원은 SearchAd 연동이 설정되어 있지 않습니다.', campaigns: [] }, { status: 400 });
  }

  try {
    const secretKey = resolveSearchadSecret(secretEnc);
    const baseUrl = searchadBaseUrl();
    const uri = '/ncc/campaigns';
    const res = await fetch(`${baseUrl}${uri}`, {
      method: 'GET',
      headers: signSearchadHeaders('GET', uri, apiLicense, secretKey, customerId),
    });
    if (!res.ok) {
      const t = await res.text();
      return NextResponse.json(
        { error: `네이버 캠페인 조회 실패 (HTTP ${res.status})`, detail: t.slice(0, 300) },
        { status: 502 },
      );
    }
    const data = (await res.json()) as Array<Record<string, unknown>>;
    const campaigns = (Array.isArray(data) ? data : [])
      .map((c) => ({
        id: String(c.nccCampaignId ?? c.id ?? '').trim(),
        name: String(c.name ?? '').trim(),
        type: String(c.campaignTp ?? '').trim(),
      }))
      .filter((c) => c.id);
    return NextResponse.json({ campaigns });
  } catch (e) {
    console.error('POST /api/admin/collect/searchad-campaigns:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
}
