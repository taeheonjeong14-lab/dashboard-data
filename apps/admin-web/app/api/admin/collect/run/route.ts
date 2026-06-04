import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

export const maxDuration = 30;

const VALID_STEPS = ['blog_metrics', 'smartplace', 'keyword_rank', 'searchad', 'place_reviews'] as const;

export async function POST(request: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  let body: {
    jobs?: Array<{
      hospitalId?: string;
      steps?: string[];
      searchadStart?: string;
      searchadEnd?: string;
      searchadCampaignIds?: string[];
    }>;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // body 없음
  }

  const rawJobs = Array.isArray(body.jobs) ? body.jobs : [];
  if (rawJobs.length === 0) {
    return NextResponse.json({ error: '수집할 병원/항목을 선택해 주세요.' }, { status: 400 });
  }

  const isYmd = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

  const validated: {
    hospital_id: string;
    steps_filter: string[] | null;
    searchad_start_date: string | null;
    searchad_end_date: string | null;
    searchad_campaign_ids: string[] | null;
  }[] = [];
  for (const job of rawJobs) {
    const hid = (job.hospitalId ?? '').trim();
    if (!hid || !/^[0-9a-f-]{8,36}$/i.test(hid)) {
      return NextResponse.json({ error: '유효하지 않은 hospital_id입니다.' }, { status: 400 });
    }
    const steps = Array.isArray(job.steps)
      ? job.steps.filter((s) => (VALID_STEPS as readonly string[]).includes(s))
      : VALID_STEPS.slice();
    if (steps.length === 0) {
      return NextResponse.json({ error: '수집 항목을 하나 이상 선택해 주세요.' }, { status: 400 });
    }

    // SearchAd 기간: searchad 단계가 포함될 때만 의미가 있다. 둘 다 있어야 적용.
    let searchadStart: string | null = null;
    let searchadEnd: string | null = null;
    if (steps.includes('searchad') && (job.searchadStart || job.searchadEnd)) {
      if (!isYmd(job.searchadStart) || !isYmd(job.searchadEnd)) {
        return NextResponse.json({ error: 'SearchAd 기간은 시작·종료일을 모두 올바르게 선택해 주세요.' }, { status: 400 });
      }
      if (job.searchadStart > job.searchadEnd) {
        return NextResponse.json({ error: 'SearchAd 기간의 시작일이 종료일보다 늦습니다.' }, { status: 400 });
      }
      searchadStart = job.searchadStart;
      searchadEnd = job.searchadEnd;
    }

    // SearchAd 선택 캠페인: searchad 단계 포함 + 비어있지 않을 때만. 빈 배열/미지정이면 전체 수집.
    let searchadCampaignIds: string[] | null = null;
    if (steps.includes('searchad') && Array.isArray(job.searchadCampaignIds)) {
      const ids = job.searchadCampaignIds.map((c) => String(c).trim()).filter(Boolean);
      if (ids.length > 0) searchadCampaignIds = ids;
    }

    validated.push({
      hospital_id: hid,
      steps_filter: steps.length < VALID_STEPS.length ? steps : null,
      searchad_start_date: searchadStart,
      searchad_end_date: searchadEnd,
      searchad_campaign_ids: searchadCampaignIds,
    });
  }

  const supabase = createServiceRoleClient();

  const { data: jobs, error: insertError } = await supabase
    .schema('analytics')
    .from('collect_jobs')
    .insert(
      validated.map(({ hospital_id, steps_filter, searchad_start_date, searchad_end_date, searchad_campaign_ids }) => ({
        hospital_id,
        ...(steps_filter ? { steps_filter } : {}),
        ...(searchad_start_date ? { searchad_start_date, searchad_end_date } : {}),
        ...(searchad_campaign_ids ? { searchad_campaign_ids } : {}),
      })),
    )
    .select('id, hospital_id');

  if (insertError || !jobs) {
    console.error('[collect/run] insert error:', insertError);
    return NextResponse.json({ error: '수집 요청을 생성하지 못했습니다.', detail: insertError?.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    jobs: (jobs as { id: string; hospital_id: string | null }[]).map((j) => ({
      id: j.id,
      hospitalId: j.hospital_id,
    })),
  });
}
