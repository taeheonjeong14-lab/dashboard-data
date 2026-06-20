import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { notifyHospitalUsers, notifyAdmins } from '@/lib/notify';
import { getAdminWebPgPool } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const LOW_BALANCE_THRESHOLD = 200; // 잔여 토큰 이 값 이하면 경고
const PLAN_EXPIRY_DAYS = 7;        // 플랜 종료 D-7 이내 경고
const STATS_OVERDUE_DAYS = 30;     // 마지막 경영통계 제출 후 이 일수 경과면 미제출 알림
const STATS_REMIND_EVERY_DAYS = 7; // 미제출 알림 리마인드 주기(도배 방지)

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return (req.headers.get('authorization') || '') === `Bearer ${secret}`;
}

// GET /api/cron/notify — 매일 1회: 토큰 잔액 부족 / 플랜 만료 임박을 마스터에게 알림
export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const srvc = createServiceRoleClient();

  const { data, error } = await srvc
    .schema('core')
    .from('hospitals')
    .select('id, token_balance, barun_plan_enabled, barun_plan_end');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const today = new Date();
  const results: { lowBalance: number; planExpiring: number } = { lowBalance: 0, planExpiring: 0 };

  for (const h of (data ?? []) as { id: string; token_balance: number | string | null; barun_plan_enabled?: boolean; barun_plan_end?: string | null }[]) {
    const balance = Number(h.token_balance) || 0;

    // 토큰 잔액 부족 (매일 리마인드 — 충전 전까지)
    if (balance <= LOW_BALANCE_THRESHOLD) {
      await notifyHospitalUsers(h.id, {
        type: 'token_low',
        title: '토큰 잔액 부족',
        body: `잔여 토큰이 ${Math.round(balance).toLocaleString()}개 남았습니다. 충전 후 끊김 없이 이용하세요.`,
      }, { role: 'master' });
      results.lowBalance += 1;
    }

    // 플랜 만료 임박 (D-7 이내, 한 번만)
    if (h.barun_plan_enabled && h.barun_plan_end) {
      const end = new Date(h.barun_plan_end + 'T00:00:00');
      const days = Math.ceil((end.getTime() - today.getTime()) / 86400000);
      if (days >= 0 && days <= PLAN_EXPIRY_DAYS) {
        // 중복 방지 — 최근 8일 내 같은 알림 있으면 스킵
        const since = new Date(Date.now() - 8 * 86400000).toISOString();
        const { count } = await srvc
          .schema('core').from('notifications')
          .select('id', { count: 'exact', head: true })
          .eq('hospital_id', h.id).eq('type', 'plan_expiring').gte('created_at', since);
        if (!count) {
          await notifyHospitalUsers(h.id, {
            type: 'plan_expiring',
            title: '플랜 만료 임박',
            body: `플랜이 ${days === 0 ? '오늘' : `${days}일 후`} 종료됩니다. 이후에는 진료케이스 토큰이 정상 차감돼요.`,
          }, { role: 'master' });
          results.planExpiring += 1;
        }
      }
    }
  }

  // ── 경영통계 미제출 (마지막 제출 30일+ 경과) ──────────────────────────
  // 병원: 마스터에게 제출 독촉 / 운영자: 미제출 병원 요약. 둘 다 7일 리마인드 주기로 dedup.
  let statsOverdue = 0;
  try {
    const pool = getAdminWebPgPool();
    // 한 번이라도 제출한 적 있는 병원의 마지막 제출일 (한 번도 제출 안 한 신규 병원은 제외 — 도배 방지)
    const { rows } = await pool.query<{ hospital_id: string; name: string | null; last: string | Date }>(
      `SELECT hospital_id, max(hospital_name) AS name, max(created_at) AS last
       FROM analytics.hospital_stats_submissions
       GROUP BY hospital_id
       HAVING max(created_at) < now() - interval '${STATS_OVERDUE_DAYS} days'`,
    );

    const remindSince = new Date(Date.now() - STATS_REMIND_EVERY_DAYS * 86400000).toISOString();
    const overdueNames: string[] = [];
    for (const r of rows) {
      const days = Math.floor((Date.now() - new Date(r.last).getTime()) / 86400000);
      overdueNames.push(r.name?.trim() || r.hospital_id);
      // 병원 마스터 제출 독촉 — 최근 7일 내 같은 알림 있으면 스킵
      const { count } = await srvc
        .schema('core').from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('hospital_id', r.hospital_id).eq('type', 'stats_overdue').gte('created_at', remindSince);
      if (!count) {
        await notifyHospitalUsers(r.hospital_id, {
          type: 'stats_overdue',
          title: '경영통계 제출이 필요해요',
          body: `마지막 경영통계 제출 후 ${days}일이 지났어요. 최신 경영통계를 제출해 주세요.`,
          link: '/dashboard',
        }, { role: 'master' });
      }
      statsOverdue += 1;
    }

    // 운영자 요약 — 최근 7일 내 같은 알림 있으면 스킵
    if (overdueNames.length > 0) {
      const { count: adminSent } = await srvc
        .schema('core').from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('type', 'stats_overdue_admin').gte('created_at', remindSince);
      if (!adminSent) {
        const preview = overdueNames.slice(0, 5).join(', ');
        const more = overdueNames.length - Math.min(5, overdueNames.length);
        await notifyAdmins({
          type: 'stats_overdue_admin',
          title: '경영통계 미제출 병원',
          body: `${overdueNames.length}곳이 ${STATS_OVERDUE_DAYS}일 이상 경영통계를 제출하지 않았어요. (${preview}${more > 0 ? ` 외 ${more}곳` : ''})`,
          link: '/admin/data-upload?section=stats',
        });
      }
    }
  } catch (e) {
    console.error('[cron/notify] stats-overdue failed:', e);
  }

  return NextResponse.json({ ok: true, ...results, statsOverdue });
}
