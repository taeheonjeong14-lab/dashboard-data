import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { sendErrorAlert } from '@/lib/error-alert';
import { errorCauseOf } from '@/lib/error-log-explain';

/**
 * GET /api/cron/error-alert — core.error_logs 를 주기적으로 훑어 새 에러를
 * fingerprint 로 묶어 운영자에게 1건 다이제스트로 발송(텔레그램/웹훅).
 *
 * 버스트 대응: 에러 1건마다 쏘지 않는다. 한 창(window) 안의 에러를 fingerprint 로
 * 뭉쳐 "9× ..." 처럼 요약 → 어제 ddx 502 9연타 같은 도배가 1줄이 된다.
 * error_logs 가 모든 앱 에러의 단일 창구라 여기 한 곳만 훑으면 전부 커버된다.
 *
 * 창 = 스케줄 간격보다 살짝 크게(누락 방지, 경계에서 드물게 중복은 감수 — 알림은 놓침이 더 나쁘다).
 * 스케줄 5분 간격, 창 6분(vercel.json 의 cron schedule 참고).
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const WINDOW_MIN = Number(process.env.ERROR_ALERT_WINDOW_MIN) || 6;
const SELF_ROUTE = '/api/cron/error-alert'; // 자기 자신 에러는 제외(무한 자가보고 방지)

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return (req.headers.get('authorization') || '') === `Bearer ${secret}`;
}

type Row = {
  app: string | null;
  source: string | null;
  route: string | null;
  feature: string | null;
  status_code: number | null;
  message: string | null;
  fingerprint: string | null;
};

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const srvc = createServiceRoleClient();
  const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();

  const { data, error } = await srvc
    .schema('core')
    .from('error_logs')
    .select('app, source, route, feature, status_code, message, fingerprint')
    .gte('occurred_at', since)
    .neq('route', SELF_ROUTE)
    .order('occurred_at', { ascending: false })
    .limit(1_000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return NextResponse.json({ ok: true, newErrors: 0, sent: false });

  // fingerprint(없으면 app|route|message 앞부분)로 그룹핑
  const groups = new Map<
    string,
    { count: number; app: string; route: string; label: string; cause: string | null; message: string; status: number | null }
  >();
  for (const r of rows) {
    const key = r.fingerprint || `${r.app}|${r.route}|${(r.message || '').slice(0, 40)}`;
    const g = groups.get(key);
    if (g) {
      g.count += 1;
    } else {
      const raw = (r.message || '').replace(/\s+/g, ' ').trim();
      groups.set(key, {
        count: 1,
        app: r.app || '?',
        route: r.route || '?',
        // 사람이 읽는 이름이 있으면 그걸 앞세운다(수집은 feature 가 '데이터 수집 — 블로그 순위' 처럼 구체적).
        label: (r.feature || '').trim() || r.route || '?',
        // 화면과 같은 규칙으로 사유를 사람 말로 바꾼다. 매칭 없으면 null → 원문으로 폴백.
        cause: errorCauseOf(raw),
        message: raw.slice(0, 160),
        status: r.status_code,
      });
    }
  }

  const sorted = [...groups.values()].sort((a, b) => b.count - a.count);
  const top = sorted.slice(0, 8);
  const base = (process.env.ADMIN_WEB_URL || '').replace(/\/$/, '');

  // 한 그룹 = 헤더(무엇이 몇 번) + 사유(사람 말). 사유 규칙이 없으면 원문을 그대로 실어 정보를 잃지 않는다.
  const lines = [
    `🚨 에러 알림 — 최근 ${WINDOW_MIN}분 새 에러 ${rows.length}건 (${sorted.length}종)`,
    '',
    ...top.map((g, i) => {
      const status = g.status ? ` ${g.status}` : '';
      const head = `${i + 1}. ×${g.count} [${g.app}]${status} ${g.label}`;
      // 사유 문구는 마침표 없이 끝난다(화면에선 explainError 가 붙인다) → 여기서 붙인다.
      const body = g.cause ? `${g.cause}.` : g.message;
      return `${head}\n   ↳ ${body}`;
    }),
  ];
  if (sorted.length > top.length) lines.push('', `…외 ${sorted.length - top.length}종 더`);
  lines.push('', base ? `${base}/admin/error-logs` : '/admin/error-logs');

  const sent = await sendErrorAlert(lines.join('\n'));
  return NextResponse.json({ ok: true, newErrors: rows.length, groups: sorted.length, sent });
}
