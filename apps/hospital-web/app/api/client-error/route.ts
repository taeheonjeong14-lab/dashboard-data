import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { fingerprintOf, logError } from '@/lib/error-log';

export const maxDuration = 10;

/**
 * 브라우저에서 터진 오류 수집. error.tsx / global-error.tsx 가 호출한다.
 *
 * 주의: 이 라우트는 withErrorLog 로 감싸지 않는다 — 로깅 실패가 다시 로깅을 부르는 재귀가 된다.
 * 로그인 세션이 있는 요청만 받는다(익명 스팸 방지). 같은 지문이 1분 내 반복되면 버린다(루프 방지).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false }, { status: 401 });

    const body = (await req.json()) as {
      message?: string;
      stack?: string;
      pathname?: string;
      componentStack?: string;
      digest?: string;
    };

    const message = (body.message ?? '').trim();
    if (!message) return NextResponse.json({ ok: false }, { status: 400 });

    const route = body.pathname ?? null;
    const fingerprint = fingerprintOf(route, message);

    // 렌더 루프로 같은 에러가 초당 수십 번 들어오는 걸 막는다.
    const since = new Date(Date.now() - 60_000).toISOString();
    const { count } = await createServiceRoleClient()
      .schema('core')
      .from('error_logs')
      .select('id', { count: 'exact', head: true })
      .eq('fingerprint', fingerprint)
      .eq('user_id', user.id)
      .gte('occurred_at', since);
    if (count && count > 0) return NextResponse.json({ ok: true, deduped: true });

    const { data: profile } = await supabase
      .schema('core')
      .from('users')
      .select('hospital_id')
      .eq('id', user.id)
      .maybeSingle();

    await logError({
      source: 'client',
      route,
      message,
      stack: body.stack ?? null,
      userId: user.id,
      hospitalId: (profile as { hospital_id?: string } | null)?.hospital_id ?? null,
      context: {
        componentStack: body.componentStack?.slice(0, 2_000),
        digest: body.digest,
        userAgent: req.headers.get('user-agent'),
      },
    });

    return NextResponse.json({ ok: true });
  } catch {
    // 수집 실패는 조용히 삼킨다. 사용자에게 보일 이유가 없다.
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
