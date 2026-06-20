import { createServiceRoleClient } from '@/lib/supabase/service-role';

type NotifyInput = { type: string; title: string; body?: string; link?: string };

// ── 운영자(admin) 알림 ──────────────────────────────────────────────
// 수신자는 core.admin_users 전체. hospital 알림과 같은 core.notifications 테이블을 쓰되
// user_id 가 admin 이라 hospital 종 아이콘엔 안 뜨고 admin 종 아이콘에만 뜬다.
type AdminNotifyInput = { type: string; title: string; body?: string; link?: string; hospitalId?: string | null };

export async function notifyAdmins(n: AdminNotifyInput): Promise<void> {
  try {
    const srvc = createServiceRoleClient();
    const { data } = await srvc.schema('core').from('admin_users').select('id');
    const recipients = (data ?? []).map((u) => (u as { id: string }).id);
    if (recipients.length === 0) return;
    await srvc.schema('core').from('notifications').insert(
      recipients.map((uid) => ({ user_id: uid, hospital_id: n.hospitalId ?? null, type: n.type, title: n.title, body: n.body ?? null, link: n.link ?? null })),
    );
  } catch (e) {
    console.error('[notifyAdmins] failed:', e);
  }
}

// 오류/실패 알림 — 백그라운드 파이프라인 실패·서버 5xx 용. 같은 source(=title) 가
// dedupMinutes(기본 15분) 안에 이미 있으면 도배 방지를 위해 건너뛴다.
const ERROR_DEDUP_MINUTES = 15;
export async function notifyAdminError(input: {
  source: string;          // 예: '데이터 수집', '알림톡 발송', '건강검진 리포트 생성'
  message?: string;        // 상세 (병원/잡 id 등)
  link?: string;
  hospitalId?: string | null;
  dedupMinutes?: number;
}): Promise<void> {
  const title = `${input.source} 오류`;
  try {
    const srvc = createServiceRoleClient();
    const since = new Date(Date.now() - (input.dedupMinutes ?? ERROR_DEDUP_MINUTES) * 60000).toISOString();
    const { count } = await srvc
      .schema('core').from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('type', 'admin_error').eq('title', title).gte('created_at', since);
    if (count && count > 0) return; // 최근 동일 오류 — dedup
    await notifyAdmins({ type: 'admin_error', title, body: input.message, link: input.link, hospitalId: input.hospitalId });
  } catch (e) {
    console.error('[notifyAdminError] failed:', e);
  }
}

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
