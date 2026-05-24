import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import type { IntakeAnswers } from '@/lib/intake/form-spec';

export const runtime = 'nodejs';

// POST /api/intake — 보호자 초진 접수증 제출 (공개, 로그인 없음)
// 공개 폼이라 브라우저엔 권한이 없으므로 서버(서비스 롤)로만 저장한다.
type Body = { hospitalId?: string; answers?: IntakeAnswers };

export async function POST(request: NextRequest) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const hospitalId = String(body.hospitalId ?? '').trim();
  const a = body.answers;
  if (!hospitalId) return NextResponse.json({ error: '병원 정보가 없습니다.' }, { status: 400 });
  if (!a || typeof a !== 'object') return NextResponse.json({ error: '응답이 비어 있습니다.' }, { status: 400 });
  if (!a.consentRequired) return NextResponse.json({ error: '필수 개인정보 수집 동의가 필요합니다.' }, { status: 400 });
  if (!String(a.ownerName ?? '').trim()) return NextResponse.json({ error: '보호자 성함을 입력해 주세요.' }, { status: 400 });
  if (!String(a.ownerPhone ?? '').trim()) return NextResponse.json({ error: '연락처를 입력해 주세요.' }, { status: 400 });
  if (!Array.isArray(a.pets) || a.pets.length === 0) {
    return NextResponse.json({ error: '아이 정보를 입력해 주세요.' }, { status: 400 });
  }

  try {
    const svc = createServiceRoleClient();

    // 병원 존재 검증
    const { data: hosp, error: hErr } = await svc
      .schema('core')
      .from('hospitals')
      .select('id')
      .eq('id', hospitalId)
      .maybeSingle();
    if (hErr) throw new Error(hErr.message);
    if (!hosp) return NextResponse.json({ error: '존재하지 않는 병원입니다.' }, { status: 404 });

    const { error } = await svc
      .schema('intake')
      .from('submissions')
      .insert({
        hospital_id: hospitalId,
        owner_name: a.ownerName?.trim() || null,
        owner_phone: a.ownerPhone?.trim() || null,
        owner_address: a.ownerAddress?.trim() || null,
        pet_count: typeof a.petCount === 'number' && a.petCount > 0 ? a.petCount : a.pets.length,
        pets: a.pets ?? [],
        referral: a.referral ?? {},
        consent_required: !!a.consentRequired,
        consent_marketing: !!a.consentMarketing,
        answers: a,
        status: 'submitted',
      });
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('POST /api/intake:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
}
