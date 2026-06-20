import { createServiceRoleClient } from '@/lib/supabase/service-role';

type NotifyInput = { type: string; title: string; body?: string; link?: string };

// 병원 유저들에게 알림 fan-out. role 지정 시 그 역할만(예: master). 활성·미거절·미삭제 유저 대상.
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

// ── 운영자(admin) 알림 ──────────────────────────────────────────────
// hospital-web 에서 발생한 오류도 운영자가 보도록 admin 종 아이콘으로 보낸다.
// 수신자는 core.admin_users 전체. (admin-web lib/notify.ts 와 동일 규칙)
async function notifyAdmins(n: { type: string; title: string; body?: string; link?: string; hospitalId?: string | null }): Promise<void> {
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

// 오류/실패 알림 — 같은 source(=title) 가 15분 안에 이미 있으면 도배 방지로 건너뛴다.
export async function notifyAdminError(input: { source: string; message?: string; link?: string; hospitalId?: string | null; dedupMinutes?: number }): Promise<void> {
  const title = `${input.source} 오류`;
  try {
    const srvc = createServiceRoleClient();
    const since = new Date(Date.now() - (input.dedupMinutes ?? 15) * 60000).toISOString();
    const { count } = await srvc
      .schema('core').from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('type', 'admin_error').eq('title', title).gte('created_at', since);
    if (count && count > 0) return;
    await notifyAdmins({ type: 'admin_error', title, body: input.message, link: input.link, hospitalId: input.hospitalId });
  } catch (e) {
    console.error('[notifyAdminError] failed:', e);
  }
}
