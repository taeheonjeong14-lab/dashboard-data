import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// GET /api/token-orders — 내 병원 토큰 구매 주문 목록
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const { data, error } = await supabase.schema('core').rpc('my_token_orders');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ orders: data ?? [] });
}

// POST /api/token-orders — body { packageId } → 주문 생성(pending)
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  let body: { packageId?: string } = {};
  try { body = (await request.json()) as typeof body; } catch { /* empty */ }
  const packageId = String(body.packageId ?? '').trim();
  if (!packageId) return NextResponse.json({ error: 'packageId가 필요합니다.' }, { status: 400 });
  const { data, error } = await supabase.schema('core').rpc('create_token_order', { p_package_id: packageId });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const d = data as { error?: string } | null;
  if (d?.error) return NextResponse.json({ error: d.error }, { status: 400 });
  return NextResponse.json({ order: data });
}
