import { NextRequest, NextResponse } from 'next/server';
import { getAdminWebPgPool } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return (req.headers.get('authorization') || '') === `Bearer ${secret}`;
}

// GET /api/cron/subscriptions — 매일 1회: 만기된 구독 자동갱신(정액 토큰 차감)·취소만료 처리.
// 잔액 부족이면 해당 구독 lapsed(차단). 바른플랜 병원은 구독 레코드가 없어 자동 면제.
export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const { rows } = await getAdminWebPgPool().query<{ renewed: number; lapsed: number }>(
      'SELECT * FROM billing.run_subscription_renewals()',
    );
    const r = rows[0] ?? { renewed: 0, lapsed: 0 };
    return NextResponse.json({ ok: true, renewed: Number(r.renewed) || 0, lapsed: Number(r.lapsed) || 0 });
  } catch (e) {
    console.error('[cron/subscriptions]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
