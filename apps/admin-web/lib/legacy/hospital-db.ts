import type { SupabaseClient } from '@supabase/supabase-js';

export const HOSPITAL_LIST_COLUMNS =
  'id,name,naver_blog_id,smartplace_stat_url,debug_port';

// meta_is_active 는 boolean 이라 값 타입을 unknown 으로 둔다(호출부가 String()/Boolean() 으로 좁힌다).
export async function fetchHospitalAdsColumns(
  supabase: SupabaseClient,
  hospitalId: string,
): Promise<Record<string, unknown>> {
  if (!hospitalId) return {};
  const { data, error } = await supabase
    .schema('core')
    .from('hospitals')
    .select(
      'searchad_customer_id,searchad_api_license,searchad_secret_key_encrypted,googleads_customer_id,googleads_refresh_token_encrypted,meta_ad_account_id,meta_is_active',
    )
    .eq('id', hospitalId)
    .maybeSingle();
  if (error) return {};
  return (data || {}) as Record<string, unknown>;
}

export async function upsertHospitalWithCompat(
  supabase: SupabaseClient,
  basePayload: Record<string, unknown>,
): Promise<void> {
  const nowIso = new Date().toISOString();
  const candidates = [
    basePayload,
    { ...basePayload, updatedAt: nowIso },
    { ...basePayload, createdAt: nowIso, updatedAt: nowIso },
    { ...basePayload, updated_at: nowIso },
    { ...basePayload, created_at: nowIso, updated_at: nowIso },
  ];

  let lastError: unknown = null;
  for (const payload of candidates) {
    const { error } = await supabase.schema('core').from('hospitals').upsert(payload, {
      onConflict: 'id',
    });
    if (!error) return;

    lastError = error;
    const msg = String((error as { message?: string })?.message || '');
    if (!/(createdAt|updatedAt|created_at|updated_at|null value in column)/i.test(msg)) {
      throw error;
    }
  }

  if (lastError) throw lastError;
}
