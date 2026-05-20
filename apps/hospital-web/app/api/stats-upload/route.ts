import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { parseIntoVet, parseWoorienPms, parseEFriends } from '@/lib/stats-parsers';

const SUPPORTED_CHART_TYPES = ['intovet', 'woorien_pms', 'efriends'] as const;
type ChartType = (typeof SUPPORTED_CHART_TYPES)[number];

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // Auth — get user session
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    // Fetch hospital info
    const { data: coreUser } = await supabase
      .schema('core')
      .from('users')
      .select('hospital_id, hospital_name')
      .eq('id', user.id)
      .single();

    const hospitalId = (coreUser?.hospital_id as string | null | undefined) ?? null;
    const hospitalName = (coreUser?.hospital_name as string | null | undefined) ?? null;

    if (!hospitalId) {
      return NextResponse.json({ error: '병원 정보를 찾을 수 없습니다.' }, { status: 400 });
    }

    // Parse FormData
    const formData = await req.formData();
    const file = formData.get('file');
    const chartType = formData.get('chartType');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: '파일이 필요합니다.' }, { status: 400 });
    }
    if (typeof chartType !== 'string' || !SUPPORTED_CHART_TYPES.includes(chartType as ChartType)) {
      return NextResponse.json({ error: '지원하지 않는 차트 종류입니다.' }, { status: 400 });
    }

    // Read file as ArrayBuffer
    const buffer = await file.arrayBuffer();

    // Parse Excel
    let parseResult;
    try {
      if (chartType === 'intovet') {
        parseResult = parseIntoVet(buffer);
      } else if (chartType === 'woorien_pms') {
        parseResult = parseWoorienPms(buffer);
      } else {
        parseResult = parseEFriends(buffer);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '엑셀 파일 파싱에 실패했습니다.';
      return NextResponse.json({ error: `파일 파싱 오류: ${msg}` }, { status: 422 });
    }

    const { kpis, rowCount, dateFrom, dateTo } = parseResult;

    const srvc = createServiceRoleClient();

    // Upsert to chart_daily_kpis
    if (kpis.length > 0) {
      const rows = kpis.map((k) => ({
        metric_date: k.metric_date,
        hospital_id: hospitalId,
        chart_type: chartType,
        sales_amount: k.sales_amount,
        visit_count: k.visit_count,
        new_customer_count: 0,
      }));

      const { error: upsertError } = await srvc
        .schema('analytics')
        .from('chart_daily_kpis')
        .upsert(rows, { onConflict: 'metric_date,hospital_id,chart_type' });

      if (upsertError) {
        console.error('[stats-upload] upsert error:', upsertError);
        return NextResponse.json({ error: '데이터 저장에 실패했습니다.' }, { status: 500 });
      }
    }

    // Insert submission record
    const { error: subError } = await srvc
      .schema('analytics')
      .from('hospital_stats_submissions')
      .insert({
        hospital_id: hospitalId,
        hospital_name: hospitalName,
        chart_type: chartType,
        file_name: file.name,
        row_count: rowCount,
        date_from: dateFrom,
        date_to: dateTo,
        status: 'done',
      });

    if (subError) {
      console.error('[stats-upload] submission insert error:', subError);
      // Non-fatal — data was saved, just log tracking failed
    }

    return NextResponse.json({ ok: true, rowCount, dateFrom, dateTo });
  } catch (e) {
    console.error('[stats-upload] unexpected error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
