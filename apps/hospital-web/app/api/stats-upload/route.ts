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
import { STATS_UPLOAD_BUCKET } from '@/lib/stats-upload-storage';

export const maxDuration = 300;

const SUPPORTED_CHART_TYPES = ['intovet', 'woorien_pms', 'efriends'] as const;
type ChartType = (typeof SUPPORTED_CHART_TYPES)[number];

/**
 * 경영통계 처리. 클라이언트가 Storage 에 직접 올린 파일의 경로(storagePath)를 받아
 * 서버에서 다운로드 → 파싱 → DB 저장 → 스테이징 파일 삭제. (파일이 함수 본문을 거치지 않아 본문 한도 무관)
 */
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

    // Parse JSON body — { storagePath, chartType, fileName }
    const body = (await req.json().catch(() => null)) as
      | { storagePath?: unknown; chartType?: unknown; fileName?: unknown }
      | null;
    const storagePath = typeof body?.storagePath === 'string' ? body.storagePath : '';
    const chartType = body?.chartType;
    const fileName = typeof body?.fileName === 'string' && body.fileName.trim() ? body.fileName : 'upload';

    if (!storagePath) {
      return NextResponse.json({ error: '파일 경로가 필요합니다.' }, { status: 400 });
    }
    if (typeof chartType !== 'string' || !SUPPORTED_CHART_TYPES.includes(chartType as ChartType)) {
      return NextResponse.json({ error: '지원하지 않는 차트 종류입니다.' }, { status: 400 });
    }
    // 보안: 경로는 반드시 본인 병원 prefix 아래여야 한다(타 병원 스테이징 파일 접근 차단).
    if (!storagePath.startsWith(`${hospitalId}/`)) {
      return NextResponse.json({ error: '잘못된 파일 경로입니다.' }, { status: 403 });
    }

    // hospital_name: 사용자가 직접 입력한 customHospitalName 우선, 없으면 core.hospitals 에서 조회.
    let hospitalName: string | null = cu?.customHospitalName?.trim() || null;
    const srvc = createServiceRoleClient();
    if (!hospitalName) {
      try {
        const { data: hospital } = await srvc
          .schema('core')
          .from('hospitals')
          .select('name')
          .eq('id', hospitalId)
          .single();
        hospitalName = (hospital as { name?: string | null } | null)?.name?.trim() || null;
      } catch {
        /* 이름 조회 실패해도 업로드 진행 */
      }
    }

    // Storage 에서 파일 다운로드
    const { data: blob, error: dlErr } = await srvc.storage.from(STATS_UPLOAD_BUCKET).download(storagePath);
    if (dlErr || !blob) {
      return NextResponse.json({ error: `업로드된 파일을 찾을 수 없습니다: ${dlErr?.message ?? ''}` }, { status: 404 });
    }
    const buffer = await blob.arrayBuffer();

    try {
      // admin "경영통계 수집" 과 동일한 파이프라인: 거래 행 파싱 → chart_transactions_raw → rebuild RPC.
      let parsed;
      try {
        if (chartType === 'intovet') {
          parsed = await parseIntoVetWorkbook(buffer, hospitalId);
        } else if (chartType === 'woorien_pms') {
          parsed = await parseWoorienPmsWorkbook(buffer, hospitalId);
        } else {
          parsed = await parseEFriendsFile({ bytes: buffer, name: fileName }, hospitalId);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : '파일 파싱에 실패했습니다.';
        return NextResponse.json({ error: `파일 파싱 오류: ${msg}` }, { status: 422 });
      }

      const preview = buildPreview(parsed.rows, parsed.errors);
      const fileHash = await fileToSha256(buffer);

      let result;
      try {
        result = await executeChartUpload({
          supabase: srvc,
          hospitalId,
          chartType,
          sourceFileName: fileName,
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
          file_name: fileName,
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
    } finally {
      // 스테이징 파일은 성공/실패와 무관하게 삭제(용량 누적 방지).
      await srvc.storage.from(STATS_UPLOAD_BUCKET).remove([storagePath]).catch(() => {});
    }
  } catch (e) {
    console.error('[stats-upload] unexpected error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
