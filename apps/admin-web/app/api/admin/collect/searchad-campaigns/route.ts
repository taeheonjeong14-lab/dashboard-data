import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

export const maxDuration = 20;

// 병원의 SearchAd 캠페인 목록을 네이버에서 조회한다(선택 수집 UI용).
// python(naver-searchad-main.py)의 서명·복호화와 동일한 방식을 JS로 구현.

/** enc:: XOR(SHA256(passphrase)) 복호화. 평문이면 그대로. */
function resolveSearchadSecret(stored: string): string {
  const v = (stored || '').trim();
  if (!v) return '';
  if (!v.startsWith('enc::')) return v; // 하위 호환(평문)
  const passphrase = (process.env.SEARCHAD_SECRET_PASSPHRASE || '').trim();
  if (!passphrase) throw new Error('SEARCHAD_SECRET_PASSPHRASE가 설정되지 않았습니다.');
  const raw = Buffer.from(v.slice('enc::'.length), 'base64');
  const key = crypto.createHash('sha256').update(passphrase, 'utf8').digest();
  const out = Buffer.alloc(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw[i] ^ key[i % key.length];
  return out.toString('utf8');
}

function signHeaders(method: string, uri: string, apiLicense: string, secretKey: string, customerId: string) {
  const timestamp = String(Date.now());
  const signature = crypto
    .createHmac('sha256', secretKey)
    .update(`${timestamp}.${method}.${uri}`)
    .digest('base64');
  return {
    'Content-Type': 'application/json; charset=UTF-8',
    'X-Timestamp': timestamp,
    'X-API-KEY': apiLicense,
    'X-Customer': customerId,
    'X-Signature': signature,
  };
}

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
    const baseUrl = (process.env.SEARCHAD_API_BASE_URL || 'https://api.searchad.naver.com').replace(/\/$/, '');
    const uri = '/ncc/campaigns';
    const res = await fetch(`${baseUrl}${uri}`, {
      method: 'GET',
      headers: signHeaders('GET', uri, apiLicense, secretKey, customerId),
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
