import type { User } from '@supabase/supabase-js'
import { getSupabaseServerClient } from './supabase-server'
import type { HospitalScope } from './queries'

export async function fetchHospitalScopeServer(user: User): Promise<HospitalScope> {
  const supabase = await getSupabaseServerClient()

  const { data: profile, error: profileError } = await supabase
    .schema('core')
    .from('users')
    .select('id,hospital_id,name')
    .eq('id', user.id)
    .maybeSingle()
  if (profileError) throw profileError

  const userName = (() => {
    const n = profile?.name
    return typeof n === 'string' && n.trim() !== '' ? n.trim() : null
  })()
  const assignedHospitalId = profile?.hospital_id != null ? String(profile.hospital_id) : null

  if (!profile?.hospital_id) {
    return { isAdmin: false, hospitals: [], userName, assignedHospitalId }
  }

  const { data: hospitals, error: hospitalError } = await supabase
    .schema('core')
    .from('hospitals')
    .select('id,name,naver_blog_id,address')
    .eq('id', profile.hospital_id)
    .order('name', { ascending: true })
  if (hospitalError) throw hospitalError

  return {
    isAdmin: false,
    hospitals: (hospitals ?? []).map((row) => ({
      hospital_id: String(row.id),
      hospital_name: row.name ?? String(row.id),
      naver_blog_id: row.naver_blog_id != null ? String(row.naver_blog_id) : null,
      address: row.address != null && String(row.address).trim() !== '' ? String(row.address).trim() : null,
    })),
    userName,
    assignedHospitalId,
  }
}
