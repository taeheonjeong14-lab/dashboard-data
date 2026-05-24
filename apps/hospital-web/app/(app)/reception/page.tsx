import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { ReceptionList, type Submission } from './reception-list';

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
        .select('*')
        .eq('hospital_id', hospitalId)
        .order('created_at', { ascending: false })
        .limit(300);
      if (error) throw new Error(error.message);
      items = (data ?? []) as Submission[];
    } catch (e) {
      loadError = e instanceof Error ? e.message : '접수 목록을 불러오지 못했습니다.';
    }
  }

  return <ReceptionList items={items} hasHospital={!!hospitalId} loadError={loadError} hospitalId={hospitalId} />;
}
