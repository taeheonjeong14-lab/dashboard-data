import { NextRequest, NextResponse } from 'next/server';
import { requireAuthedApi } from '@/lib/require-auth-api';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { formatSupabaseError } from '@/lib/format-supabase-error';

type CoreUserRow = Record<string, unknown>;

async function listCoreUsersWithCompat(supabase: ReturnType<typeof createServiceRoleClient>) {
  const attempts = [
    // "DDx-style"
    'id,email,name,phone,approved,rejected,active,hospital_id,custom_hospital_name,hospital_address,hospital_address_detail,created_at',
    // camelCase timestamps
    'id,email,name,phone,approved,rejected,active,hospital_id,custom_hospital_name,hospital_address,hospital_address_detail,createdAt',
    // Minimal common subset
    'id,email,name,hospital_id,role,created_at',
    'id,email,name,hospital_id,role,createdAt',
    // Bare minimum
    'id,email,name,hospital_id',
  ];

  let lastError: unknown = null;
  for (const cols of attempts) {
    const res = await supabase
      .schema('core')
      .from('users')
      .select(cols)
      .is('deleted_at', null)
      .order(cols.includes('createdAt') ? 'createdAt' : 'created_at', { ascending: false });
    if (!res.error) return { rows: (res.data || []) as unknown as CoreUserRow[] };
    lastError = res.error;
  }
  throw lastError;
}

export async function GET(request: NextRequest) {
  const gate = await requireAuthedApi();
  if (!gate.ok) return gate.response;

  try {
    const supabase = createServiceRoleClient();
    const { rows } = await listCoreUsersWithCompat(supabase);

    // Optional hospital name join (best-effort).
    const hospitalIds = Array.from(
      new Set(
        rows
          .map((r) => String(r.hospital_id || '').trim())
          .filter(Boolean),
      ),
    );

    // emailVerified / hospital_role 는 신규 컬럼이라 메인 select 호환성 영향 없이 별도 best-effort 조회.
    const metaById = new Map<string, { emailVerified: boolean; hospitalRole: string | null }>();
    {
      const ids = rows.map((r) => String(r.id)).filter(Boolean);
      if (ids.length) {
        const mr = await supabase.schema('core').from('users').select('id, emailVerified, hospital_role').in('id', ids);
        if (!mr.error) {
          (mr.data || []).forEach((m) => {
            const mm = m as { id: string; emailVerified?: boolean; hospital_role?: string | null };
            metaById.set(String(mm.id), { emailVerified: Boolean(mm.emailVerified), hospitalRole: mm.hospital_role ?? null });
          });
        }
      }
    }

    const hospitalNameById = new Map<string, { id: string; name: string | null }>();
    if (hospitalIds.length) {
      const hRes = await supabase
        .schema('core')
        .from('hospitals')
        .select('id,name')
        .in('id', hospitalIds);
      if (!hRes.error) {
        (hRes.data || []).forEach((h) => {
          hospitalNameById.set(String(h.id), { id: String(h.id), name: (h as { name?: string | null }).name ?? null });
        });
      }
    }

    const users = rows.map((u) => {
      const hospitalId = u.hospital_id != null ? String(u.hospital_id) : null;
      const hospital = hospitalId ? hospitalNameById.get(hospitalId) ?? null : null;

      return {
        id: String(u.id),
        email: u.email != null ? String(u.email) : null,
        name: u.name != null ? String(u.name) : null,
        phone: u.phone != null ? String(u.phone) : null,
        approved: u.approved != null ? Boolean(u.approved) : false,
        rejected: u.rejected != null ? Boolean(u.rejected) : false,
        active: u.active != null ? Boolean(u.active) : true,
        hospitalId,
        customHospitalName: u.custom_hospital_name != null ? String(u.custom_hospital_name) : null,
        hospitalAddress: u.hospital_address != null ? String(u.hospital_address) : null,
        hospitalAddressDetail: u.hospital_address_detail != null ? String(u.hospital_address_detail) : null,
        createdAt: u.created_at ?? u.createdAt ?? null,
        emailVerified: metaById.get(String(u.id))?.emailVerified ?? false,
        hospitalRole: metaById.get(String(u.id))?.hospitalRole ?? null,
        hospital,
      };
    });

    return NextResponse.json({ success: true, users });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: formatSupabaseError(e) },
      { status: 500 },
    );
  }
}

