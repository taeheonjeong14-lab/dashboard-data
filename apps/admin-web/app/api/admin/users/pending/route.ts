import { NextRequest, NextResponse } from 'next/server';
import { requireAuthedApi } from '@/lib/require-auth-api';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { formatSupabaseError } from '@/lib/format-supabase-error';

export async function GET(_request: NextRequest) {
  const gate = await requireAuthedApi();
  if (!gate.ok) return gate.response;

  try {
    const supabase = createServiceRoleClient();

    const listAttempts = [
      { cols: 'id,email,name,phone,approved,rejected,active,emailVerified,hospital_role,hospital_id,custom_hospital_name,hospital_address,hospital_address_detail,created_at', order: 'created_at' },
      { cols: 'id,email,name,phone,approved,rejected,active,emailVerified,hospital_role,hospital_id,custom_hospital_name,hospital_address,hospital_address_detail,createdAt', order: 'createdAt' },
      { cols: 'id,email,name,approved,rejected,active,emailVerified,hospital_role,hospital_id,createdAt', order: 'createdAt' },
      { cols: 'id,email,name,approved,rejected,active,emailVerified,hospital_role,hospital_id,created_at', order: 'created_at' },
    ] as const;

    let listRes: any = null;
    let lastErr: unknown = null;
    for (const att of listAttempts) {
      const res = await (supabase.schema('core').from('users') as any)
        .select(att.cols)
        .is('deleted_at', null)
        .eq('approved', false)
        .eq('rejected', false)
        .order(att.order, { ascending: false });
      if (!res.error) {
        listRes = res;
        break;
      }
      lastErr = res.error;
    }
    if (!listRes) throw lastErr;

    const [totalRes, pendingRes] = await Promise.all([
      supabase.schema('core').from('users').select('id', { count: 'exact', head: true }),
      supabase
        .schema('core')
        .from('users')
        .select('id', { count: 'exact', head: true })
        .is('deleted_at', null)
        .eq('approved', false)
        .eq('rejected', false),
    ]);

    if (listRes.error) throw listRes.error;
    if (totalRes.error) throw totalRes.error;
    if (pendingRes.error) throw pendingRes.error;

    return NextResponse.json({
      success: true,
      users: listRes.data || [],
      totalCount: totalRes.count ?? null,
      pendingCount: pendingRes.count ?? null,
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: formatSupabaseError(e) },
      { status: 500 },
    );
  }
}

