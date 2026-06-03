import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

export const maxDuration = 10;

// GET /api/admin/intake/submissions?hospitalId=... — 병원별 초진 접수 목록(전체 필드)
export async function GET(request: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const hospitalId = new URL(request.url).searchParams.get('hospitalId')?.trim();
  if (!hospitalId) {
    return NextResponse.json({ error: 'hospitalId가 필요합니다.' }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .schema('intake')
    .from('submissions')
    .select(
      'id, owner_name, owner_phone, owner_address, pet_count, referral, consent_required, consent_marketing, answers, status, created_at, submission_pets(*)',
    )
    .eq('hospital_id', hospitalId)
    .order('created_at', { ascending: false })
    .limit(300);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 정규화된 submission_pets(snake_case) → 기존 응답 모양(camelCase pets)으로 매핑
  const submissions = (data ?? []).map((row) => {
    const r = row as Record<string, unknown> & { submission_pets?: Array<Record<string, unknown>> };
    const pets = (r.submission_pets ?? [])
      .slice()
      .sort((x, y) => Number(x.pet_index ?? 0) - Number(y.pet_index ?? 0))
      .map((p) => ({
        name: String(p.name ?? ''),
        species: String(p.species ?? ''),
        breed: String(p.breed ?? ''),
        breedOther: String(p.breed_other ?? ''),
        birthDate: String(p.birth_date ?? ''),
        ageUnknown: Boolean(p.age_unknown),
        ageText: String(p.age_text ?? ''),
        sex: String(p.sex ?? ''),
        registration: String(p.registration ?? ''),
        insurance: String(p.insurance ?? ''),
        symptoms: Array.isArray(p.symptoms) ? p.symptoms : [],
        symptomDetail: String(p.symptom_detail ?? ''),
      }));
    return { ...r, pets, submission_pets: undefined };
  });
  return NextResponse.json({ submissions });
}
