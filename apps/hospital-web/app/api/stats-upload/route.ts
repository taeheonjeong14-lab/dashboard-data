import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import {
  buildPreview,
  executeChartUpload,
  fileToSha256,
  parseIntoVetWorkbook,
  parseWoorienPmsWorkbook,
  parseEFriendsFile,
} from '@dashboard/chart-ingest';

export const maxDuration = 300;

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

    // Fetch hospital info — core.users 에는 hospital_name 컬럼이 없다(customHospitalName 만).
    // 존재하지 않는 컬럼을 select 하면 PostgREST 가 전체 query 를 에러로 처리해 hospitalId 까지 못 받는 회귀가 있었음.
    const { data: coreUser, error: coreUserErr } = await supabase
      .schema('core')
      .from('users')
      .select('hospital_id, customHospitalName')
      .eq('id', user.id)
      .single();
    if (coreUserErr) {
      console.warn('[stats-upload] core.users select error:', coreUserErr.message);
    }

    const cu = coreUser as { hospital_id?: string | null; customHospitalName?: string | null } | null;
    const hospitalId = cu?.hospital_id ?? null;

    if (!hospitalId) {
      return NextResponse.json({ error: '병원 정보를 찾을 수 없습니다.' }, { status: 400 });
    }

    // hospital_name: 사용자가 직접 입력한 customHospitalName 우선, 없으면 core.hospitals 에서 조회.
    let hospitalName: string | null = cu?.customHospitalName?.trim() || null;
    if (!hospitalName) {
      try {
        const srvcLookup = createServiceRoleClient();
        const { data: hospital } = await srvcLookup
          .schema('core')
          .from('hospitals')
          .select('name')
          .eq('id', hospitalId)
          .single();
        hospitalName = (hospital as { name?: string | null } | null)?.name?.trim() || null;
      } catch {
        /* 이름 조회 실패해도 업로드 진행 — submission 의 hospital_name 은 null 로 둔다 */
      }
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

    const buffer = await file.arrayBuffer();

    // admin "경영통계 수집" 과 완전히 동일한 파이프라인:
    // 거래 행 단위 파싱 → chart_transactions_raw → rebuild_chart_for_run RPC(신규환자 포함).
    // efriends 는 CSV 인코딩 판별을 위해 {bytes,name} 스냅샷을, 나머지는 ArrayBuffer 를 넘긴다(admin 과 동일).
    let parsed;
    try {
      if (chartType === 'intovet') {
        parsed = await parseIntoVetWorkbook(buffer, hospitalId);
      } else if (chartType === 'woorien_pms') {
        parsed = await parseWoorienPmsWorkbook(buffer, hospitalId);
      } else {
        parsed = await parseEFriendsFile({ bytes: buffer, name: file.name }, hospitalId);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '파일 파싱에 실패했습니다.';
      return NextResponse.json({ error: `파일 파싱 오류: ${msg}` }, { status: 422 });
    }

    const preview = buildPreview(parsed.rows, parsed.errors);
    const fileHash = await fileToSha256(buffer);

    const srvc = createServiceRoleClient();

    let result;
    try {
      result = await executeChartUpload({
        supabase: srvc,
        hospitalId,
        chartType,
        sourceFileName: file.name,
        sourceFileHash: fileHash,
        parsedRows: parsed.rows,
        parseErrors: parsed.errors,
      });
    } catch (e) {
      console.error('[stats-upload] executeChartUpload error:', e);
      const msg = e instanceof Error ? e.message : '데이터 저장에 실패했습니다.';
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    // Insert submission record (제출 이력 추적)
    const { error: subError } = await srvc
      .schema('analytics')
      .from('hospital_stats_submissions')
      .insert({
        hospital_id: hospitalId,
        hospital_name: hospitalName,
        chart_type: chartType,
        file_name: file.name,
        row_count: result.importedRows,
        date_from: preview.startDate,
        date_to: preview.endDate,
        status: 'done',
      });

    if (subError) {
      console.error('[stats-upload] submission insert error:', subError);
      // Non-fatal — data was saved, just log tracking failed
    }

    return NextResponse.json({
      ok: true,
      rowCount: result.importedRows,
      dateFrom: preview.startDate,
      dateTo: preview.endDate,
      affectedDays: result.affectedDays,
      errorRows: result.errorRows,
    });
  } catch (e) {
    console.error('[stats-upload] unexpected error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
