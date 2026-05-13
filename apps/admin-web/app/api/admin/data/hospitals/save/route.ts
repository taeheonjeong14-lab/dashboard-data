import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { formatSupabaseError } from '@/lib/format-supabase-error';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { upsertHospitalWithCompat } from '@/lib/legacy/hospital-db';

function parseKeywordLines(text: string) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ keyword: line }));
}

function createHospitalId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

type FormBody = {
  editingId?: string;
  hospitalForm: {
    name: string;
    name_en?: string;
    code?: string;
    phone?: string;
    address?: string;
    addressDetail?: string;
    logoUrl?: string;
    brandColor?: string;
    director_name_ko?: string;
    seal_url?: string;
    tagline_line1?: string;
    tagline_line2?: string;
    blog_intro?: string;
    blog_outro?: string;
    naver_blog_id?: string;
    smartplace_stat_url?: string;
    debug_port?: string;
    blog_keywords_text?: string;
    place_keywords_text?: string;
    searchad_customer_id?: string;
    searchad_api_license?: string;
    searchad_secret_key_encrypted?: string;
    googleads_customer_id?: string;
    googleads_refresh_token_encrypted?: string;
  };
};

export async function POST(request: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  let body: FormBody;
  try {
    body = (await request.json()) as FormBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { editingId, hospitalForm } = body;
  if (!hospitalForm?.name?.trim()) {
    return NextResponse.json({ error: '병원명이 필요합니다.' }, { status: 400 });
  }

  try {
    const supabase = createServiceRoleClient();

    const hospitalId = editingId?.trim() || createHospitalId();
    const scid = (hospitalForm.searchad_customer_id || '').trim();
    const sal = (hospitalForm.searchad_api_license || '').trim();
    const ssec = (hospitalForm.searchad_secret_key_encrypted || '').trim();
    const searchadReady = !!(scid && sal && ssec);
    const searchadClear = !scid && !sal && !ssec;
    const gcid = (hospitalForm.googleads_customer_id || '').trim().replace(/-/g, '');
    const grt = (hospitalForm.googleads_refresh_token_encrypted || '').trim();
    const googleadsReady = !!(gcid && grt);
    const googleadsClear = !gcid && !grt;

    const payload: Record<string, unknown> = {
      id: hospitalId,
      name: hospitalForm.name.trim(),
      name_en: (hospitalForm.name_en || '').trim() || null,
      code: (hospitalForm.code || '').trim() || null,
      phone: (hospitalForm.phone || '').trim() || null,
      address: (hospitalForm.address || '').trim() || null,
      addressDetail: (hospitalForm.addressDetail || '').trim() || null,
      logoUrl: (hospitalForm.logoUrl || '').trim() || null,
      brandColor: (hospitalForm.brandColor || '').trim() || null,
      director_name_ko: (hospitalForm.director_name_ko || '').trim() || null,
      seal_url: (hospitalForm.seal_url || '').trim() || null,
      tagline_line1: (hospitalForm.tagline_line1 || '').trim() || null,
      tagline_line2: (hospitalForm.tagline_line2 || '').trim() || null,
      blog_intro: (hospitalForm.blog_intro || '').trim() || null,
      blog_outro: (hospitalForm.blog_outro || '').trim() || null,
      naver_blog_id: (hospitalForm.naver_blog_id || '').trim() || null,
      smartplace_stat_url: (hospitalForm.smartplace_stat_url || '').trim() || null,
      debug_port: hospitalForm.debug_port ? Number(hospitalForm.debug_port) : null,
    };

    if (searchadReady) {
      payload.searchad_customer_id = scid;
      payload.searchad_api_license = sal;
      payload.searchad_secret_key_encrypted = ssec;
      payload.searchad_is_active = true;
    } else if (searchadClear) {
      payload.searchad_customer_id = null;
      payload.searchad_api_license = null;
      payload.searchad_secret_key_encrypted = null;
      payload.searchad_is_active = false;
    }
    if (googleadsReady) {
      payload.googleads_customer_id = gcid;
      payload.googleads_refresh_token_encrypted = grt;
      payload.googleads_is_active = true;
    } else if (googleadsClear) {
      payload.googleads_customer_id = null;
      payload.googleads_refresh_token_encrypted = null;
      payload.googleads_is_active = false;
    }

    await upsertHospitalWithCompat(supabase, payload);

    const resolvedHospitalId = String(hospitalId || payload.id || '').trim();
    if (!resolvedHospitalId) {
      throw new Error('hospital_id를 확인할 수 없습니다.');
    }

    const { error: blogDeactivateErr } = await supabase
      .schema('analytics')
      .from('analytics_blog_keyword_targets')
      .delete()
      .eq('hospital_id', resolvedHospitalId);
    if (blogDeactivateErr) throw blogDeactivateErr;

    const blogKeywords = parseKeywordLines(hospitalForm.blog_keywords_text || '');
    if (blogKeywords.length > 0) {
      const { error: btErr } = await supabase
        .schema('analytics')
        .from('analytics_blog_keyword_targets')
        .insert(
          blogKeywords.map((item) => ({
            hospital_id: resolvedHospitalId,
            account_id: (hospitalForm.naver_blog_id || '').trim(),
            keyword: item.keyword,
            is_active: true,
            source: 'admin-web',
          })),
        );
      if (btErr) throw btErr;
    }

    const { error: placeDeactivateErr } = await supabase
      .schema('analytics')
      .from('analytics_place_keyword_targets')
      .delete()
      .eq('hospital_id', resolvedHospitalId);
    if (placeDeactivateErr) throw placeDeactivateErr;

    const placeKeywords = parseKeywordLines(hospitalForm.place_keywords_text || '');
    if (placeKeywords.length > 0) {
      const { error: ptErr } = await supabase
        .schema('analytics')
        .from('analytics_place_keyword_targets')
        .insert(
          placeKeywords.map((item) => ({
            hospital_id: resolvedHospitalId,
            keyword: item.keyword,
            is_active: true,
            source: 'admin-web',
          })),
        );
      if (ptErr) throw ptErr;
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: formatSupabaseError(e) }, { status: 500 });
  }
}
