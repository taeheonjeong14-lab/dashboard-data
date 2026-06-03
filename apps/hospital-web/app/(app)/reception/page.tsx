import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import type { PetAnswer } from '@/lib/intake/form-spec';
import { ReceptionList, type Submission } from './reception-list';

/** 정규화된 submission_pets(snake_case) → UI가 기대하는 PetAnswer(camelCase) 매핑. */
function mapPet(p: Record<string, unknown>): PetAnswer {
  return {
    name: String(p.name ?? ''),
    species: String(p.species ?? '') as PetAnswer['species'],
    breed: String(p.breed ?? ''),
    breedOther: String(p.breed_other ?? ''),
    birthDate: String(p.birth_date ?? ''),
    ageUnknown: Boolean(p.age_unknown),
    ageText: String(p.age_text ?? ''),
    sex: String(p.sex ?? ''),
    registration: String(p.registration ?? ''),
    insurance: String(p.insurance ?? ''),
    symptoms: Array.isArray(p.symptoms) ? (p.symptoms as string[]) : [],
    symptomOther: String(p.symptom_other ?? ''),
    surveyLinked: p.survey_linked === true ? true : undefined,
    surveySessionId: p.survey_session_id ? String(p.survey_session_id) : undefined,
  };
}

export const dynamic = 'force-dynamic';

export default async function ReceptionPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let hospitalId: string | null = null;
  if (user) {
    const { data } = await supabase
      .schema('core')
      .from('users')
      .select('hospital_id')
      .eq('id', user.id)
      .single();
    hospitalId = (data as { hospital_id?: string | null } | null)?.hospital_id ?? null;
  }

  let items: Submission[] = [];
  let loadError: string | null = null;
  if (hospitalId) {
    try {
      const svc = createServiceRoleClient();
      const { data, error } = await svc
        .schema('intake')
        .from('submissions')
        .select('*, submission_pets(*)')
        .eq('hospital_id', hospitalId)
        .order('created_at', { ascending: false })
        .limit(300);
      if (error) throw new Error(error.message);
      items = (data ?? []).map((row) => {
        const r = row as Record<string, unknown> & {
          submission_pets?: Array<Record<string, unknown>>;
        };
        const pets = (r.submission_pets ?? [])
          .slice()
          .sort((x, y) => Number(x.pet_index ?? 0) - Number(y.pet_index ?? 0))
          .map(mapPet);
        return { ...r, pets } as unknown as Submission;
      });
    } catch (e) {
      loadError = e instanceof Error ? e.message : '접수 목록을 불러오지 못했습니다.';
    }
  }

  return <ReceptionList items={items} hasHospital={!!hospitalId} loadError={loadError} hospitalId={hospitalId} />;
}
