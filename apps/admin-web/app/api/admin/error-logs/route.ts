import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

export const maxDuration = 15;

const PAGE_SIZE = 50;

/**
 * hospital-web 오류 로그 조회. core.error_logs 는 RLS 로 잠겨 있어 service_role 로만 읽는다.
 *
 * ?source=server|client  ?hospitalId=  ?days=7  ?q=  ?fingerprint=  ?page=0
 * fingerprint 를 주면 같은 지문의 발생 이력만 본다(그룹 상세).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const sp = req.nextUrl.searchParams;
  const days = Math.min(Math.max(Number(sp.get('days') ?? '7') || 7, 1), 90);
  const page = Math.max(Number(sp.get('page') ?? '0') || 0, 0);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const supabase = createServiceRoleClient();
  let query = supabase
    .schema('core')
    .from('error_logs')
    .select(
      'id, occurred_at, app, source, route, method, status_code, feature, message, stack, hospital_id, user_id, request_body, context, fingerprint',
      { count: 'exact' },
    )
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

  const source = sp.get('source');
  if (source === 'server' || source === 'client') query = query.eq('source', source);

  const hospitalId = sp.get('hospitalId');
  if (hospitalId) query = query.eq('hospital_id', hospitalId);

  const fingerprint = sp.get('fingerprint');
  if (fingerprint) query = query.eq('fingerprint', fingerprint);

  const q = sp.get('q')?.trim();
  if (q) {
    // message 와 route 양쪽에서 찾는다. %,_ 는 like 메타문자라 이스케이프.
    const safe = q.replace(/[%_]/g, (m) => `\\${m}`);
    query = query.or(`message.ilike.%${safe}%,route.ilike.%${safe}%`);
  }

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 병원명을 붙여준다 — id 만 보면 admin 이 못 알아본다.
  const hospitalIds = [...new Set((data ?? []).map((r) => r.hospital_id).filter(Boolean))] as string[];
  const names: Record<string, string> = {};
  if (hospitalIds.length > 0) {
    const { data: hospitals } = await supabase
      .schema('core')
      .from('hospitals')
      .select('id, name')
      .in('id', hospitalIds);
    for (const h of hospitals ?? []) names[(h as { id: string }).id] = (h as { name: string }).name;
  }

  return NextResponse.json({
    logs: (data ?? []).map((r) => ({ ...r, hospital_name: r.hospital_id ? (names[r.hospital_id] ?? null) : null })),
    total: count ?? 0,
    pageSize: PAGE_SIZE,
    page,
  });
}

/** 오래된 로그 정리. ?days=30 이전 것을 지운다. */
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get('days') ?? '30') || 30, 1), 365);
  const before = new Date(Date.now() - days * 86_400_000).toISOString();

  const { error } = await createServiceRoleClient()
    .schema('core')
    .from('error_logs')
    .delete()
    .lt('occurred_at', before);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, deletedBefore: before });
}
