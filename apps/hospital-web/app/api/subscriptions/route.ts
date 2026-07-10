import { NextResponse } from 'next/server';
import { withErrorLog } from '@/lib/with-error-log';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// GET /api/subscriptions — 내 병원 구독/메뉴 상태(바른플랜·잔액·구독상품)
export const GET = withErrorLog({ route: '/api/subscriptions', feature: '구독 조회' }, handleGET);

async function handleGET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const { data, error } = await supabase.schema('core').rpc('my_subscription_status');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? { barun: false, balance: null, products: [] });
}

// POST /api/subscriptions — body { productCode, action?: 'subscribe'|'cancel' }
export const POST = withErrorLog({ route: '/api/subscriptions', feature: '구독 변경' }, handlePOST);

async function handlePOST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  let body: { productCode?: string; action?: string } = {};
  try { body = (await request.json()) as typeof body; } catch { /* empty */ }
  const productCode = String(body.productCode ?? '').trim();
  if (!productCode) return NextResponse.json({ error: 'productCode가 필요합니다.' }, { status: 400 });
  const cancel = body.action === 'cancel';
  const { data, error } = await supabase
    .schema('core')
    .rpc(cancel ? 'cancel_my_subscription' : 'subscribe_to_product', { p_product_code: productCode });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ result: data as string });
}
