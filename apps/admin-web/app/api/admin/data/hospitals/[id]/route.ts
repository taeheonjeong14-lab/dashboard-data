import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { formatSupabaseError } from '@/lib/format-supabase-error';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { fetchHospitalAdsColumns } from '@/lib/legacy/hospital-db';

function buildKeywordText(rows: { keyword: string }[] | null | undefined) {
  return (rows || []).map((r) => `${r.keyword}`).join('\n');
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const { id } = await context.params;
  const hospitalId = String(id || '').trim();
  if (!hospitalId) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  try {
    const supabase = createServiceRoleClient();

    const rowAttempts = [
      'id,name,name_en,code,phone,address,addressDetail,logoUrl,brandColor,director_name_ko,seal_url,tagline_line1,tagline_line2,blog_intro,blog_outro,naver_blog_id,smartplace_stat_url,smartplace_review_url,debug_port',
      'id,name,name_en,code,phone,address,address_detail,logo_url,brand_color,director_name_ko,seal_url,tagline_line1,tagline_line2,blog_intro,blog_outro,naver_blog_id,smartplace_stat_url,smartplace_review_url,debug_port',
      // 폴백: review_url 컬럼이 아직 없을 수 있으므로 제외(마이그레이션 전 우아하게 degrade)
      'id,name,naver_blog_id,smartplace_stat_url,debug_port',
    ];

    let row: Record<string, unknown> | null = null;
    let rowErr: unknown = null;
    for (const cols of rowAttempts) {
      const res = await supabase
        .schema('core')
        .from('hospitals')
        .select(cols)
        .eq('id', hospitalId)
        .maybeSingle();
      if (!res.error) {
        row = (res.data || null) as Record<string, unknown> | null;
        rowErr = null;
        break;
      }
      rowErr = res.error;
    }

    if (rowErr) throw rowErr;
    if (!row) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const [bt, pt] = await Promise.all([
      supabase
        .schema('analytics')
        .from('analytics_blog_keyword_targets')
        .select('keyword')
        .eq('hospital_id', hospitalId)
        .eq('is_active', true),
      supabase
        .schema('analytics')
        .from('analytics_place_keyword_targets')
        .select('keyword')
        .eq('hospital_id', hospitalId)
        .eq('is_active', true),
    ]);

    if (bt.error) throw bt.error;
    if (pt.error) throw pt.error;

    const ads = await fetchHospitalAdsColumns(supabase, hospitalId);

    // 컬럼이 아직 없을 수 있으므로 방어적으로 조회 (마이그레이션 전이면 false)
    let intakeSurveyEnabled = false;
    {
      const r = await supabase
        .schema('core')
        .from('hospitals')
        .select('intake_survey_enabled')
        .eq('id', hospitalId)
        .maybeSingle();
      if (!r.error) {
        intakeSurveyEnabled = (r.data as { intake_survey_enabled?: boolean } | null)?.intake_survey_enabled === true;
      }
    }

    const base = {
      id: String(row.id || ''),
      name: String(row.name || ''),
      name_en: String(row.name_en || ''),
      code: String(row.code || ''),
      phone: String(row.phone || ''),
      address: String(row.address || ''),
      addressDetail: String((row.addressDetail ?? row.address_detail) || ''),
      logoUrl: String((row.logoUrl ?? row.logo_url) || ''),
      brandColor: String((row.brandColor ?? row.brand_color) || ''),
      director_name_ko: String(row.director_name_ko || ''),
      seal_url: String(row.seal_url || ''),
      tagline_line1: String(row.tagline_line1 || ''),
      tagline_line2: String(row.tagline_line2 || ''),
      blog_intro: String(row.blog_intro || ''),
      blog_outro: String(row.blog_outro || ''),
      naver_blog_id: String(row.naver_blog_id || ''),
      smartplace_stat_url: String(row.smartplace_stat_url || ''),
      smartplace_review_url: String(row.smartplace_review_url || ''),
      debug_port: row.debug_port == null ? '' : String(row.debug_port),
      blog_keywords_text: buildKeywordText(bt.data || []),
      place_keywords_text: buildKeywordText(pt.data || []),
      searchad_customer_id:
        ads.searchad_customer_id != null ? String(ads.searchad_customer_id || '') : '',
      searchad_api_license:
        ads.searchad_api_license != null ? String(ads.searchad_api_license || '') : '',
      searchad_secret_key_encrypted:
        ads.searchad_secret_key_encrypted != null
          ? String(ads.searchad_secret_key_encrypted || '')
          : '',
      googleads_customer_id:
        ads.googleads_customer_id != null ? String(ads.googleads_customer_id || '') : '',
      googleads_refresh_token_encrypted:
        ads.googleads_refresh_token_encrypted != null
          ? String(ads.googleads_refresh_token_encrypted || '')
          : '',
      intake_survey_enabled: intakeSurveyEnabled,
    };

    // 경쟁병원(최대 3) — 테이블 미생성 가능성 대비 방어적으로 조회
    let competitors: { slot: number; name: string; naver_blog_id: string; smartplace_review_url: string }[] = [];
    {
      const r = await supabase
        .schema('analytics')
        .from('analytics_hospital_competitors')
        .select('slot, name, naver_blog_id, smartplace_review_url')
        .eq('hospital_id', hospitalId)
        .order('slot', { ascending: true });
      if (!r.error && Array.isArray(r.data)) {
        competitors = r.data.map((c) => ({
          slot: Number((c as { slot?: number }).slot) || 0,
          name: String((c as { name?: string }).name || ''),
          naver_blog_id: String((c as { naver_blog_id?: string }).naver_blog_id || ''),
          smartplace_review_url: String((c as { smartplace_review_url?: string }).smartplace_review_url || ''),
        }));
      }
    }

    return NextResponse.json({ form: { ...base, competitors } });
  } catch (e) {
    return NextResponse.json({ error: formatSupabaseError(e) }, { status: 500 });
  }
}
