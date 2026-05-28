import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

const VALID_CHART_TYPES = ['intovet', 'woorien_pms', 'efriends'] as const;

async function resolveHospitalId(userId: string): Promise<string | null> {
  const srvc = createServiceRoleClient();
  const { data } = await srvc
    .schema('core')
    .from('users')
    .select('hospital_id')
    .eq('id', userId)
    .single();
  const hid = (data as { hospital_id?: string | null } | null)?.hospital_id;
  return hid ? String(hid) : null;
}

/** 병원 관리 정보 조회 — name/phone/address(읽기전용) + chart_type/vet_count(수정 가능). */
export async function GET(): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const hospitalId = await resolveHospitalId(user.id);
  if (!hospitalId) {
    return NextResponse.json({ ok: true, hospital: null });
  }

  const srvc = createServiceRoleClient();
  const { data, error } = await srvc
    .schema('core')
    .from('hospitals')
    .select('id, name, phone, address, addressDetail, chart_type, vet_count')
    .eq('id', hospitalId)
    .single();
  if (error) {
    console.error('[settings/hospital] select error:', error);
    return NextResponse.json({ error: '병원 정보를 불러오지 못했습니다.' }, { status: 500 });
  }

  const row = data as {
    id: string;
    name?: string | null;
    phone?: string | null;
    address?: string | null;
    addressDetail?: string | null;
    chart_type?: string | null;
    vet_count?: number | null;
  };

  return NextResponse.json({
    ok: true,
    hospital: {
      id: row.id,
      name: row.name ?? '',
      phone: row.phone ?? '',
      address: [row.address, row.addressDetail].filter(Boolean).join(' ').trim(),
      chartType: row.chart_type ?? '',
      vetCount: row.vet_count ?? null,
    },
  });
}

/** chart_type / vet_count 만 수정 (name/phone/address 는 admin 전용이라 여기서 안 받음). */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const hospitalId = await resolveHospitalId(user.id);
  if (!hospitalId) {
    return NextResponse.json({ error: '배정된 병원이 없습니다.' }, { status: 400 });
  }

  const body = await req.json() as { chartType?: string; vetCount?: number | null };
  const updates: Record<string, string | number | null> = {};

  if ('chartType' in body) {
    const ct = (body.chartType ?? '').trim();
    if (ct && !VALID_CHART_TYPES.includes(ct as (typeof VALID_CHART_TYPES)[number])) {
      return NextResponse.json({ error: '지원하지 않는 차트 종류입니다.' }, { status: 400 });
    }
    updates.chart_type = ct || null;
  }

  if ('vetCount' in body) {
    const raw = body.vetCount;
    if (raw == null || raw === ('' as unknown)) {
      updates.vet_count = null;
    } else {
      const n = Math.trunc(Number(raw));
      if (!Number.isFinite(n) || n < 1 || n > 100) {
        return NextResponse.json({ error: '수의사 수는 1~100 사이여야 합니다.' }, { status: 400 });
      }
      updates.vet_count = n;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: '변경할 항목이 없습니다.' }, { status: 400 });
  }

  const srvc = createServiceRoleClient();
  const { error } = await srvc
    .schema('core')
    .from('hospitals')
    .update(updates)
    .eq('id', hospitalId);
  if (error) {
    console.error('[settings/hospital] update error:', error);
    return NextResponse.json({ error: '저장에 실패했습니다.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
