import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { parseChartKind, type ChartKind } from '@/lib/chart-extraction/chart-kind';
import { refineLabFlag } from '@dashboard/lab-normalize';
import type { PlanRow, RunDetailResponse } from '@/lib/admin-run-detail-types';
import { computeBlogStage, computeHealthStage } from '@/lib/case-status';

function lineCount(text: string): number {
  return String(text || '')
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0).length;
}

function normFlag(raw: unknown): 'low' | 'high' | 'normal' | 'unknown' {
  const f = String(raw || 'unknown').toLowerCase();
  return f === 'low' || f === 'high' || f === 'normal' ? f : 'unknown';
}

const CHART_TYPE_NOTICE: Record<ChartKind, string> = {
  intovet:
    'IntoVet: 방문수는 (일자 + 고객 + 환자) unique 기준으로 집계합니다. 미상(고객명/환자명 누락) 행은 매출에는 포함되지만 방문/신규고객에는 제외됩니다.',
  plusvet: 'PlusVet 차트: 원천 데이터 구조에 따라 지표 해석이 달라질 수 있습니다.',
  efriends:
    'eFriends: 방문수는 (일자 + 고객) 기준 해석을 권장합니다. H컬럼 괄호 안 환자명은 참고용입니다. [RETAIL SALES] 행은 매출만 포함합니다.',
  other: '차트 종류가 기타로 분류되었습니다. 지표 해석 시 원천 데이터 구조를 확인하세요.',
  woorien_pms: '우리엔PMS: S.O.A.P 일자별 기록 + 검사결과 패널 구조입니다. 초기 버전이라 일부 구간이 누락되거나 잘못 나뉠 수 있습니다.',
};

/** admin-data-console CHART_TYPE_HELP 와 유사 — DB chart_type 문자열 기준 */
function chartTypeNoticeFor(kind: ChartKind): string {
  return CHART_TYPE_NOTICE[kind] ?? CHART_TYPE_NOTICE.other;
}

const SIGNED_URL_TTL = 60 * 60; // 1시간

function basename(p: string): string {
  const parts = String(p).split('/');
  return parts[parts.length - 1] || String(p);
}

/**
 * 병원이 업로드한 원본 PDF의 서명 URL을 만든다. (이미지는 이미지 분석 탭에서 보므로 제외)
 * - PDF: health_report.extract_jobs(run_id=runId) 의 storage_bucket/storage_paths
 * - 폴백: admin 직접 업로드는 chart_pdf.parse_runs.raw_payload 에 경로가 들어있다.
 * 실패해도 상세 조회 전체가 깨지지 않도록 빈 결과로 폴백한다.
 */
async function loadRunSourceFiles(
  sb: ReturnType<typeof createServiceRoleClient>,
  runId: string,
  rawPayload: unknown,
): Promise<RunDetailResponse['sourceFiles']> {
  try {
    const jobRes = await sb
      .schema('health_report')
      .from('extract_jobs')
      .select('storage_bucket, storage_paths')
      .eq('run_id', runId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const pdfs: RunDetailResponse['sourceFiles']['pdfs'] = [];
    const job = jobRes.data as { storage_bucket?: string; storage_paths?: unknown } | null;
    if (job) {
      const bucket = String(job.storage_bucket || 'pdf-uploads');
      const paths = Array.isArray(job.storage_paths)
        ? (job.storage_paths as unknown[]).filter((p): p is string => typeof p === 'string' && p.length > 0)
        : [];
      if (paths.length) {
        const { data } = await sb.storage.from(bucket).createSignedUrls(paths, SIGNED_URL_TTL);
        paths.forEach((p, i) => {
          const url = data?.[i]?.signedUrl;
          if (url) pdfs.push({ name: basename(p), url });
        });
      }
    }

    // 폴백: admin에서 직접 올린 run은 extract_jobs 가 없고 경로가 parse_runs.raw_payload 에 들어있다.
    if (pdfs.length === 0 && rawPayload && typeof rawPayload === 'object') {
      const rp = rawPayload as { storageBucket?: unknown; storagePath?: unknown };
      const path = typeof rp.storagePath === 'string' ? rp.storagePath : '';
      if (path) {
        const bucket = typeof rp.storageBucket === 'string' && rp.storageBucket ? rp.storageBucket : 'pdf-uploads';
        const { data } = await sb.storage.from(bucket).createSignedUrl(path, SIGNED_URL_TTL);
        if (data?.signedUrl) pdfs.push({ name: basename(path), url: data.signedUrl });
      }
    }

    return { pdfs };
  } catch (e) {
    console.error('loadRunSourceFiles:', e);
    return { pdfs: [] };
  }
}

function ensureLabRaw(itemName: unknown, rawItemName: unknown): { itemName: string; itemRawName: string } {
  const name = String(itemName ?? '').trim();
  const raw = String(rawItemName ?? '').trim();
  if (raw) return { itemName: name, itemRawName: raw };
  return { itemName: name, itemRawName: name };
}

function mapPlanRow(r: Record<string, unknown>): PlanRow {
  return {
    id: String(r.id ?? ''),
    code: r.code != null ? String(r.code) : null,
    treatmentPrescription: r.treatment_prescription != null ? String(r.treatment_prescription) : null,
    qty: r.qty != null ? String(r.qty) : null,
    unit: r.unit != null ? String(r.unit) : null,
    day: r.day != null ? String(r.day) : null,
    total: r.total != null ? String(r.total) : null,
    route: r.route != null ? String(r.route) : null,
    signId: r.sign_id != null ? String(r.sign_id) : null,
    rawText: r.raw_text != null ? String(r.raw_text) : null,
  };
}

/**
 * PostgREST(Supabase)만 사용 — `DATABASE_URL` 없이 상세 조회 가능.
 */
export async function loadAdminRunDetail(runId: string): Promise<RunDetailResponse | null> {
  const sb = createServiceRoleClient();
  const schema = 'chart_pdf' as const;

  const runRes = await sb
    .schema(schema)
    .from('parse_runs')
    .select('id, created_at, friendly_id, document_id, raw_payload')
    .eq('id', runId)
    .maybeSingle();

  if (runRes.error) throw new Error(runRes.error.message);
  const runRow = runRes.data as Record<string, unknown> | null;
  if (!runRow?.id) return null;

  const documentId = String(runRow.document_id ?? '');
  const [
    docRes,
    basicRes,
    chartsRes,
    labsRes,
    plansRes,
    vacRes,
    vitalsRes,
    physicalRes,
    hospitalWebRes,
  ] = await Promise.all([
    documentId
      ? sb.schema(schema).from('documents').select('file_name, chart_type').eq('id', documentId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    sb.schema(schema).from('result_basic_info').select('*').eq('parse_run_id', runId).maybeSingle(),
    sb
      .schema(schema)
      .from('result_chart_by_date')
      .select('*')
      .eq('parse_run_id', runId)
      .order('row_order', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true }),
    sb
      .schema(schema)
      .from('result_lab_items')
      .select('*')
      .eq('parse_run_id', runId)
      .order('row_order', { ascending: true, nullsFirst: false }),
    sb
      .schema(schema)
      .from('result_plan_rows')
      .select('*')
      .eq('parse_run_id', runId)
      .order('row_order', { ascending: true, nullsFirst: false }),
    sb
      .schema(schema)
      .from('result_vaccination_records')
      .select('*')
      .eq('parse_run_id', runId)
      .order('row_order', { ascending: true, nullsFirst: false }),
    sb
      .schema(schema)
      .from('result_vitals')
      .select('*')
      .eq('parse_run_id', runId)
      .order('row_order', { ascending: true }),
    sb
      .schema(schema)
      .from('result_physical_exam_items')
      .select('*')
      .eq('parse_run_id', runId)
      .order('row_order', { ascending: true, nullsFirst: false }),
    sb
      .schema('health_report')
      .from('generated_run_content')
      .select('content_type, payload')
      .eq('parse_run_id', runId)
      .in('content_type', ['hospital_notes', 'blog_case', 'health_checkup', 'blog_causal', 'blog_detail', 'blog_outline', 'blog_post']),
  ]);

  for (const r of [docRes, basicRes, chartsRes, labsRes, plansRes, vacRes, vitalsRes, physicalRes]) {
    if (r.error) throw new Error(r.error.message);
  }
  const hospitalWebRows = ((hospitalWebRes.data ?? []) as { content_type?: unknown; payload?: { confirmed?: unknown } }[]) ?? [];
  const hospitalContentTypes = new Set(hospitalWebRows.map((r) => String(r.content_type ?? '')));
  const blogConfirmed = hospitalWebRows.some((r) => String(r.content_type ?? '') === 'blog_post' && r.payload?.confirmed === true);
  const blogStage = computeBlogStage(hospitalContentTypes, blogConfirmed);
  const healthStage = computeHealthStage(hospitalContentTypes);
  const isHealthCheckup = healthStage !== 'none';
  const isBlog = blogStage !== 'none';

  const doc = docRes.data as Record<string, unknown> | null;
  const chartTypeRaw = doc?.chart_type;
  const chartType = parseChartKind(chartTypeRaw) ?? 'other';

  const basicRow = basicRes.data as Record<string, unknown> | null;
  const basicInfo = basicRow
    ? {
        id: String(basicRow.id ?? ''),
        hospitalName: basicRow.hospital_name != null ? String(basicRow.hospital_name) : null,
        ownerName: basicRow.owner_name != null ? String(basicRow.owner_name) : null,
        patientName: basicRow.patient_name != null ? String(basicRow.patient_name) : null,
        species: basicRow.species != null ? String(basicRow.species) : null,
        breed: basicRow.breed != null ? String(basicRow.breed) : null,
        birth: basicRow.birth != null ? String(basicRow.birth) : null,
        age: basicRow.age != null && basicRow.age !== '' ? Number(basicRow.age) : null,
        sex: basicRow.sex != null ? String(basicRow.sex) : null,
      }
    : null;

  const chartRows = (chartsRes.data ?? []) as Record<string, unknown>[];
  const chartIdToDateTime = new Map<string, string>();
  for (const c of chartRows) {
    const id = String(c.id ?? '');
    if (id) chartIdToDateTime.set(id, String(c.date_time ?? ''));
  }

  const chartBodyByDate = chartRows.map((c) => {
    const bodyText = String(c.body_text ?? '');
    const planText = String(c.plan_text ?? '');
    return {
      id: String(c.id ?? ''),
      dateTime: String(c.date_time ?? ''),
      bodyText,
      planText,
      lineCount: lineCount(bodyText) + lineCount(planText),
      planDetected: Boolean(c.plan_detected),
      planRowsFromText: [] as PlanRow[],
    };
  });

  const planRowsRaw = (plansRes.data ?? []) as Record<string, unknown>[];
  const planByDateMap = new Map<string, PlanRow[]>();
  for (const p of planRowsRaw) {
    const chartByDateId = p.chart_by_date_id != null ? String(p.chart_by_date_id) : '';
    const dateTime = chartIdToDateTime.get(chartByDateId) ?? '—';
    const row = mapPlanRow(p);
    const list = planByDateMap.get(dateTime) ?? [];
    list.push(row);
    planByDateMap.set(dateTime, list);
  }
  const planByDate = [...planByDateMap.entries()]
    .map(([dateTime, rows]) => ({ dateTime, rows }))
    .sort((a, b) => a.dateTime.localeCompare(b.dateTime));

  const labRows = (labsRes.data ?? []) as Record<string, unknown>[];
  const labByDate = new Map<string, RunDetailResponse['labItemsByDate'][number]['items']>();
  for (const r of labRows) {
    const dt = String(r.date_time ?? '');
    const labNames = ensureLabRaw(r.item_name, r.raw_item_name);
    const valueText = String(r.value_text ?? '');
    const referenceRange = r.reference_range != null ? String(r.reference_range) : null;
    const item = {
      id: String(r.id ?? ''),
      itemName: labNames.itemName,
      itemRawName: labNames.itemRawName,
      valueText,
      unit: r.unit != null ? String(r.unit) : null,
      referenceRange,
      flag: refineLabFlag(normFlag(r.flag), valueText, referenceRange),
    };
    const list = labByDate.get(dt) ?? [];
    list.push(item);
    labByDate.set(dt, list);
  }
  const labItemsByDate: RunDetailResponse['labItemsByDate'] = [...labByDate.entries()].map(([dateTime, items]) => ({
    dateTime,
    items,
    source: (items.length ? 'rules' : 'empty') as 'rules' | 'empty' | 'llm',
    error: null,
    lineCount: 0,
  }));

  const vacRows = (vacRes.data ?? []) as Record<string, unknown>[];
  const vaccinationRecords = vacRows.map((v) => ({
    id: String(v.id ?? ''),
    recordType: (String(v.record_type ?? '') === 'ectoparasite' ? 'ectoparasite' : 'preventive') as
      | 'preventive'
      | 'ectoparasite',
    doseOrder: String(v.dose_order ?? ''),
    productName: String(v.product_name ?? ''),
    administeredDate: v.administered_date != null ? String(v.administered_date) : null,
    sign: v.sign != null ? String(v.sign) : null,
  }));

  const vitRows = (vitalsRes.data ?? []) as Record<string, unknown>[];
  const vitalsByDate = vitRows.map((v) => ({
    id: String(v.id ?? ''),
    dateTime: String(v.date_time ?? ''),
    weight: v.weight != null ? String(v.weight) : null,
    temperature: v.temperature != null ? String(v.temperature) : null,
    respiratoryRate: v.respiratory_rate != null ? String(v.respiratory_rate) : null,
    heartRate: v.heart_rate != null ? String(v.heart_rate) : null,
    bpSystolic: v.bp_systolic != null ? String(v.bp_systolic) : null,
    bpDiastolic: v.bp_diastolic != null ? String(v.bp_diastolic) : null,
    rawText: v.raw_text != null ? String(v.raw_text) : null,
  }));

  const phyRows = (physicalRes.data ?? []) as Record<string, unknown>[];
  const physicalMap = new Map<string, RunDetailResponse['physicalExamByDate'][number]['items']>();
  for (const r of phyRows) {
    const dt = String(r.date_time ?? '');
    const item = {
      id: String(r.id ?? ''),
      itemName: String(r.item_name ?? ''),
      referenceRange: r.reference_range != null ? String(r.reference_range) : null,
      valueText: String(r.value_text ?? ''),
      unit: r.unit != null ? String(r.unit) : null,
      rawText: r.raw_text != null ? String(r.raw_text) : null,
    };
    const list = physicalMap.get(dt) ?? [];
    list.push(item);
    physicalMap.set(dt, list);
  }
  const physicalExamByDate = [...physicalMap.entries()].map(([dateTime, items]) => ({ dateTime, items }));

  const createdAt =
    runRow.created_at != null
      ? new Date(String(runRow.created_at)).toISOString()
      : new Date().toISOString();

  const sourceFiles = await loadRunSourceFiles(sb, runId, runRow.raw_payload);

  return {
    run: {
      id: String(runRow.id),
      createdAt,
      friendlyId: runRow.friendly_id != null ? String(runRow.friendly_id) : null,
      fileName: doc?.file_name != null ? String(doc.file_name) : null,
      chartType,
      isHealthCheckup,
      isBlog,
      blogStage,
      healthStage,
    },
    basicInfo,
    chartTypeNotice: chartTypeNoticeFor(chartType),
    sourceFiles,
    chartBodyByDate,
    labItemsByDate,
    vaccinationRecords,
    planByDate,
    vitalsByDate,
    physicalExamByDate,
  };
}
