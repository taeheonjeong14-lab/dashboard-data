import { createServiceRoleClient } from '@/lib/supabase/service-role';

type NotifyInput = { type: string; title: string; body?: string; link?: string };

// 병원 유저들에게 알림 fan-out (활성·미거절·미삭제). role 지정 시 그 역할만.
export async function notifyHospitalUsers(
  hospitalId: string | null | undefined,
  n: NotifyInput,
  opts?: { role?: 'master' | 'staff' },
): Promise<void> {
  if (!hospitalId) return;
  try {
    const srvc = createServiceRoleClient();
    const { data } = await srvc
      .schema('core')
      .from('users')
      .select('id, hospital_role')
      .eq('hospital_id', hospitalId)
      .eq('rejected', false)
      .is('deleted_at', null);
    const recipients = (data ?? [])
      .filter((u) => (opts?.role ? (u as { hospital_role?: string }).hospital_role === opts.role : true))
      .map((u) => (u as { id: string }).id);
    if (recipients.length === 0) return;
    await srvc.schema('core').from('notifications').insert(
      recipients.map((uid) => ({ user_id: uid, hospital_id: hospitalId, type: n.type, title: n.title, body: n.body ?? null, link: n.link ?? null })),
    );
  } catch (e) {
    console.error('[notify] failed:', e);
  }
}

// 차트 run 으로부터 병원ID·환자명 조회 (best-effort).
export async function runHospitalAndPatient(runId: string): Promise<{ hospitalId: string | null; patientName: string }> {
  try {
    const srvc = createServiceRoleClient();
    const [{ data: run }, { data: bi }] = await Promise.all([
      srvc.schema('chart_pdf').from('parse_runs').select('hospital_id').eq('id', runId).maybeSingle(),
      srvc.schema('chart_pdf').from('result_basic_info').select('patient_name').eq('parse_run_id', runId).maybeSingle(),
    ]);
    return {
      hospitalId: (run as { hospital_id?: string | null } | null)?.hospital_id ?? null,
      patientName: ((bi as { patient_name?: string | null } | null)?.patient_name ?? '').trim(),
    };
  } catch {
    return { hospitalId: null, patientName: '' };
  }
}
