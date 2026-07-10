import { NextRequest, NextResponse } from 'next/server';
import { withErrorLog } from '@/lib/with-error-log';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { notifyHospitalUsers } from '@/lib/notify';
import type { IntakeAnswers } from '@/lib/intake/form-spec';

export const runtime = 'nodejs';

// POST /api/intake — 보호자 초진 접수증 제출 (공개, 로그인 없음)
// 공개 폼이라 브라우저엔 권한이 없으므로 서버(서비스 롤)로만 저장한다.
type Body = { hospitalId?: string; answers?: IntakeAnswers };

export const POST = withErrorLog({ route: '/api/intake', feature: '초진 접수증 제출' }, handlePOST);

async function handlePOST(request: NextRequest) {
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

    // 1) 접수 본문 저장 (pets 는 정규화 테이블로 분리, 원본은 answers 에 유지)
    const { data: inserted, error } = await svc
      .schema('intake')
      .from('submissions')
      .insert({
        hospital_id: hospitalId,
        owner_name: a.ownerName?.trim() || null,
        owner_phone: a.ownerPhone?.trim() || null,
        owner_address: a.ownerAddress?.trim() || null,
        pet_count: typeof a.petCount === 'number' && a.petCount > 0 ? a.petCount : a.pets.length,
        referral: a.referral ?? {},
        consent_required: !!a.consentRequired,
        consent_marketing: !!a.consentMarketing,
        answers: a,
        status: 'submitted',
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);

    // 2) 펫 단위 정규화 저장 (분석/조회용)
    const submissionId = (inserted as { id: string }).id;
    const petRows = (a.pets ?? []).map((p, i) => ({
      submission_id: submissionId,
      hospital_id: hospitalId,
      pet_index: i,
      name: p.name?.trim() || null,
      species: p.species || null,
      breed: p.breed?.trim() || null,
      breed_other: p.breedOther?.trim() || null,
      birth_date: p.birthDate?.trim() ? p.birthDate.trim() : null,
      age_unknown: !!p.ageUnknown,
      age_text: p.ageText?.trim() || null,
      sex: p.sex || null,
      registration: p.registration || null,
      insurance: p.insurance || null,
      symptoms: Array.isArray(p.symptoms) ? p.symptoms : [],
      symptom_detail: p.symptomDetail?.trim() || null,
      survey_linked: !!p.surveyLinked,
      survey_session_id: p.surveySessionId || null,
    }));
    if (petRows.length > 0) {
      const { error: petErr } = await svc.schema('intake').from('submission_pets').insert(petRows);
      if (petErr) throw new Error(petErr.message);
    }

    // 병원 유저 알림 — 초진 접수증 작성됨
    const petName = (a.pets?.[0]?.name ?? '').trim();
    await notifyHospitalUsers(hospitalId, {
      type: 'intake_submitted',
      title: '초진 접수증 도착',
      body: `${a.ownerName?.trim() || '보호자'}/${petName || '환자'}이(가) 초진 접수증을 작성해주셨어요. 확인해주세요.`,
      link: '/reception',
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('POST /api/intake:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
}
