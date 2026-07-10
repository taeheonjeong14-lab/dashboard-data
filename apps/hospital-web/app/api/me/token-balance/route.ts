import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { withErrorLog } from '@/lib/with-error-log';

export const dynamic = 'force-dynamic';

/**
 * 내 병원 토큰 잔액. 상단 바가 주기적으로 다시 읽는다.
 *
 * 왜 필요한가: 잔액은 (app)/layout.tsx 가 서버에서 한 번 읽어 TopBar 로 내려준다.
 * 그런데 Next 레이아웃은 클라이언트 내비게이션에서 다시 렌더되지 않아, 로그인 시점 값이
 * 탭을 닫을 때까지 그대로 남는다. 작업으로 토큰을 써도 상단 바는 옛 숫자를 보여준다.
 */
export const GET = withErrorLog({ route: '/api/me/token-balance', feature: '토큰 잔액 조회' }, handleGET);

async function handleGET(): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .schema('core')
    .from('users')
    .select('hospital_id')
    .eq('id', user.id)
    .maybeSingle();

  const hospitalId = (profile as { hospital_id?: string } | null)?.hospital_id;
  if (!hospitalId) return NextResponse.json({ tokenBalance: null });

  // 잔액은 병원 단위이고 core.hospitals 는 병원 유저에게 열려 있지 않다 → 서비스 롤로 읽는다.
  const { data: hospital, error } = await createServiceRoleClient()
    .schema('core')
    .from('hospitals')
    .select('token_balance')
    .eq('id', hospitalId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const raw = (hospital as { token_balance?: number | string | null } | null)?.token_balance;
  return NextResponse.json({ tokenBalance: raw == null ? null : Number(raw) });
}
