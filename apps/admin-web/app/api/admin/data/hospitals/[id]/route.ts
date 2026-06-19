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
      'id,name,name_en,code,phone,address,addressDetail,chart_type,vet_count,logoUrl,brandColor,director_name_ko,seal_url,tagline_line1,tagline_line2,blog_intro,blog_outro,naver_blog_id,smartplace_stat_url,smartplace_review_url,debug_port',
      'id,name,name_en,code,phone,address,address_detail,chart_type,vet_count,logo_url,brand_color,director_name_ko,seal_url,tagline_line1,tagline_line2,blog_intro,blog_outro,naver_blog_id,smartplace_stat_url,smartplace_review_url,debug_port',
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

    // 바른반려연구소 플랜 — 컬럼 미존재 가능성 대비 방어적 조회
    let barunEnabled = false;
    let barunStart = '';
    let barunEnd = '';
    {
      const r = await supabase
        .schema('core')
        .from('hospitals')
        .select('barun_plan_enabled, barun_plan_start, barun_plan_end')
        .eq('id', hospitalId)
        .maybeSingle();
      if (!r.error && r.data) {
        const d = r.data as { barun_plan_enabled?: boolean; barun_plan_start?: string | null; barun_plan_end?: string | null };
        barunEnabled = d.barun_plan_enabled === true;
        barunStart = d.barun_plan_start ? String(d.barun_plan_start).slice(0, 10) : '';
        barunEnd = d.barun_plan_end ? String(d.barun_plan_end).slice(0, 10) : '';
      }
    }

    // 네이버 로그인 계정 + 마스터 희망(키워드/경쟁병원) — 컬럼 미존재 대비 방어적 조회
    let naverLoginId = '';
    let naverLoginPw = '';
    let wishKeywords: string[] = [];
    let wishCompetitors: string[] = [];
    {
      const r = await supabase.schema('core').from('hospitals').select('naver_login_id, naver_login_pw, wish_keywords, wish_competitors').eq('id', hospitalId).maybeSingle();
      if (!r.error && r.data) {
        const d = r.data as { naver_login_id?: string | null; naver_login_pw?: string | null; wish_keywords?: string[] | null; wish_competitors?: string[] | null };
        naverLoginId = d.naver_login_id ?? '';
        naverLoginPw = d.naver_login_pw ?? '';
        wishKeywords = Array.isArray(d.wish_keywords) ? d.wish_keywords : [];
        wishCompetitors = Array.isArray(d.wish_competitors) ? d.wish_competitors : [];
      }
    }

    // 잔여 토큰(삭제 확인 표시용) — 컬럼 미존재 대비 방어적 조회
    let tokenBalance = 0;
    {
      const r = await supabase.schema('core').from('hospitals').select('token_balance').eq('id', hospitalId).maybeSingle();
      if (!r.error && r.data) tokenBalance = Number((r.data as { token_balance?: number | string | null }).token_balance) || 0;
    }

    const base = {
      id: String(row.id || ''),
      name: String(row.name || ''),
      name_en: String(row.name_en || ''),
      code: String(row.code || ''),
      phone: String(row.phone || ''),
      address: String(row.address || ''),
      addressDetail: String((row.addressDetail ?? row.address_detail) || ''),
      chart_type: String(row.chart_type || ''),
      vet_count: row.vet_count == null ? '' : String(row.vet_count),
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
      naver_login_id: naverLoginId,
      naver_login_pw: naverLoginPw,
      wish_keywords: wishKeywords,
      wish_competitors: wishCompetitors,
      intake_survey_enabled: intakeSurveyEnabled,
      barun_plan_enabled: barunEnabled,
      barun_plan_start: barunStart,
      barun_plan_end: barunEnd,
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

    return NextResponse.json({ form: { ...base, competitors }, tokenBalance });
  } catch (e) {
    return NextResponse.json({ error: formatSupabaseError(e) }, { status: 500 });
  }
}

// DELETE /api/admin/data/hospitals/[id] — 병원 삭제. (잔여 토큰/환불 연계는 별도 — 지금은 확인 후 단순 삭제)
// core.users.hospital_id 는 onDelete SetNull 로 풀린다.
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;
  const { id } = await context.params;
  const hospitalId = String(id || '').trim();
  if (!hospitalId) return NextResponse.json({ error: 'id required' }, { status: 400 });
  try {
    const supabase = createServiceRoleClient();
    const { error } = await supabase.schema('core').from('hospitals').delete().eq('id', hospitalId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: formatSupabaseError(e) }, { status: 500 });
  }
}
