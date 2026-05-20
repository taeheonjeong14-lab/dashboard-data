import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const body = await req.json() as {
    name?: string;
    phone?: string;
    customHospitalName?: string;
    hospital_address?: string;
    hospital_address_detail?: string;
  };

  const updates: Record<string, string | null> = {};
  if ('name' in body) updates.name = body.name?.trim() || null;
  if ('phone' in body) updates.phone = body.phone?.trim() || null;
  if ('customHospitalName' in body) updates.customHospitalName = body.customHospitalName?.trim() || null;
  if ('hospital_address' in body) updates.hospital_address = body.hospital_address?.trim() || null;
  if ('hospital_address_detail' in body) updates.hospital_address_detail = body.hospital_address_detail?.trim() || null;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: '변경할 항목이 없습니다.' }, { status: 400 });
  }

  const srvc = createServiceRoleClient();
  const { error } = await srvc
    .schema('core')
    .from('users')
    .update(updates)
    .eq('id', user.id);

  if (error) {
    console.error('[settings/profile] update error:', error);
    return NextResponse.json({ error: '저장에 실패했습니다.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
