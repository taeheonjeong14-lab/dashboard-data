import { getChartPgPool } from '@/lib/db';
import type { ReportSourceData } from '@/lib/chart-app/report-types';

function lineCount(text: string) {
  return String(text || '')
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0).length;
}

export async function loadReportSourceData(runId: string): Promise<ReportSourceData> {
  const pool = getChartPgPool();
  const [run, basic, charts, labs, vaccinations, plans, physical, images] = await Promise.all([
    pool.query(
      `select id, created_at, friendly_id, provider, model, parser_version, document_id
       from chart_pdf.parse_runs where id = $1::uuid limit 1`,
      [runId],
    ),
    pool.query(
      `select hospital_name, owner_name, patient_name, species, breed, birth, age, sex
       from chart_pdf.result_basic_info where parse_run_id = $1::uuid limit 1`,
      [runId],
    ),
    pool.query(
      `select date_time, body_text, plan_text, plan_detected, row_order
       from chart_pdf.result_chart_by_date where parse_run_id = $1::uuid order by row_order nulls last, date_time`,
      [runId],
    ),
    pool.query(
      `select date_time, item_name, value_text, unit, reference_range, flag, row_order
       from chart_pdf.result_lab_items where parse_run_id = $1::uuid order by row_order nulls last, date_time`,
      [runId],
    ),
    pool.query(
      `select record_type, dose_order, product_name, administered_date, sign, row_order
       from chart_pdf.result_vaccination_records where parse_run_id = $1::uuid order by row_order nulls last`,
      [runId],
    ),
    pool.query(
      `select coalesce(c.date_time, '—') as date_time, p.code, p.treatment_prescription, p.qty, p.unit, p.day, p.total, p.route, p.sign_id, p.raw_text, p.row_order
       from chart_pdf.result_plan_rows p
       left join chart_pdf.result_chart_by_date c on c.id = p.chart_by_date_id
       where p.parse_run_id = $1::uuid
       order by p.row_order nulls last`,
      [runId],
    ),
    pool.query(
      `select date_time, item_name, reference_range, value_text, unit, raw_text, row_order
       from chart_pdf.result_physical_exam_items where parse_run_id = $1::uuid order by row_order nulls last`,
      [runId],
    ).catch(() => ({ rows: [] as Array<Record<string, unknown>> })),
    pool.query(
      // examDate 는 지금까지 created_at(= DB 저장 시각 = 업로드한 날)이었다. 건강검진 리포트의 '검진일 필터'가
      // 이 값에 의존하므로 그대로 둔다(바꾸면 촬영일이 비어 있는 이미지가 리포트에서 통째로 빠진다).
      // 대신 **실제 촬영일(exam_date)** 을 examDateExact 로 따로 내려준다 — 진료케이스의 날짜 앵커는
      // 이것만 쓴다. 저장일(오늘)을 촬영일로 착각해 '오늘'이 최초 진단일이 되는 사고를 막기 위함.
      `select id, (created_at::date)::text as exam_date, (exam_date::date)::text as exam_date_exact,
              file_name, exam_type, radiology_sub,
              brief_comment, has_notable_finding, related_assessment_condition, storage_path, created_at
       from chart_pdf.parse_run_case_images where parse_run_id = $1::uuid order by idx`,
      [runId],
    ).catch(() => ({ rows: [] as Array<Record<string, unknown>> })),
  ]);

  const labByDate = new Map<string, Array<{ itemName: string; valueText: string; unit: string | null; referenceRange: string | null; flag: 'low' | 'high' | 'normal' | 'unknown' }>>();
  for (const r of labs.rows as Array<Record<string, unknown>>) {
    const dt = String(r.date_time || '');
    const list = labByDate.get(dt) ?? [];
    const f = String(r.flag || 'unknown').toLowerCase();
    list.push({
      itemName: String(r.item_name || ''),
      valueText: String(r.value_text || ''),
      unit: (r.unit as string | null) ?? null,
      referenceRange: (r.reference_range as string | null) ?? null,
      flag: f === 'low' || f === 'high' || f === 'normal' ? (f as 'low' | 'high' | 'normal') : 'unknown',
    });
    labByDate.set(dt, list);
  }

  const physicalByDate = new Map<string, Array<{ itemName: string; referenceRange: string | null; valueText: string; unit: string | null; rawText: string | null }>>();
  for (const r of physical.rows as Array<Record<string, unknown>>) {
    const dt = String(r.date_time || '');
    const list = physicalByDate.get(dt) ?? [];
    list.push({
      itemName: String(r.item_name || ''),
      referenceRange: (r.reference_range as string | null) ?? null,
      valueText: String(r.value_text || ''),
      unit: (r.unit as string | null) ?? null,
      rawText: (r.raw_text as string | null) ?? null,
    });
    physicalByDate.set(dt, list);
  }

  return {
    run: {
      id: String(run.rows[0]?.id || runId),
      createdAt: new Date(run.rows[0]?.created_at || new Date()).toISOString(),
      friendlyId: (run.rows[0]?.friendly_id as string | null) ?? null,
      provider: (run.rows[0]?.provider as string | null) ?? null,
      model: (run.rows[0]?.model as string | null) ?? null,
      parserVersion: (run.rows[0]?.parser_version as string | null) ?? null,
      fileName: null,
      chartType: 'intovet',
    },
    basicInfo: basic.rows[0]
      ? {
          hospitalName: (basic.rows[0].hospital_name as string | null) ?? null,
          ownerName: (basic.rows[0].owner_name as string | null) ?? null,
          patientName: (basic.rows[0].patient_name as string | null) ?? null,
          species: (basic.rows[0].species as string | null) ?? null,
          breed: (basic.rows[0].breed as string | null) ?? null,
          birth: (basic.rows[0].birth as string | null) ?? null,
          age: (basic.rows[0].age as number | null) ?? null,
          sex: (basic.rows[0].sex as string | null) ?? null,
        }
      : null,
    chartBodyByDate: (charts.rows as Array<Record<string, unknown>>).map((c) => ({
      dateTime: String(c.date_time || ''),
      bodyText: String(c.body_text || ''),
      planText: String(c.plan_text || ''),
      lineCount: lineCount(String(c.body_text || '')) + lineCount(String(c.plan_text || '')),
      planDetected: Boolean(c.plan_detected),
    })),
    labItemsByDate: [...labByDate.entries()].map(([dateTime, items]) => ({
      dateTime,
      items,
      source: (items.length ? 'rules' : 'empty') as 'rules' | 'empty' | 'llm',
      error: null,
      lineCount: 0,
    })),
    vaccinationRecords: (vaccinations.rows as Array<Record<string, unknown>>).map((v) => ({
      recordType: String(v.record_type || '') === 'ectoparasite' ? 'ectoparasite' : 'preventive',
      doseOrder: String(v.dose_order || ''),
      productName: String(v.product_name || ''),
      administeredDate: (v.administered_date as string | null) ?? null,
      sign: (v.sign as string | null) ?? null,
    })),
    planByDate: (() => {
      const byDate = new Map<string, ReportSourceData['planByDate'][number]['rows']>();
      for (const p of plans.rows as Array<Record<string, unknown>>) {
        const dt = String(p.date_time || '—');
        const list = byDate.get(dt) ?? [];
        list.push({
          code: (p.code as string | null) ?? null,
          treatmentPrescription: (p.treatment_prescription as string | null) ?? null,
          qty: (p.qty as string | null) ?? null,
          unit: (p.unit as string | null) ?? null,
          day: (p.day as string | null) ?? null,
          total: (p.total as string | null) ?? null,
          route: (p.route as string | null) ?? null,
          signId: (p.sign_id as string | null) ?? null,
          rawText: (p.raw_text as string | null) ?? null,
        });
        byDate.set(dt, list);
      }
      return [...byDate.entries()].map(([dateTime, rows]) => ({ dateTime, rows }));
    })(),
    physicalExamItemsByDate: [...physicalByDate.entries()].map(([dateTime, items]) => ({ dateTime, items })),
    caseImages: (images.rows as Array<Record<string, unknown>>).map((img) => ({
      id: String(img.id || ''),
      examDate: String(img.exam_date || ''),
      // 실제 촬영일(없을 수 있음). 진료케이스 날짜 앵커 전용 — 업로드일(examDate)과 섞지 말 것.
      examDateExact: String(img.exam_date_exact || ''),
      fileName: String(img.file_name || ''),
      examType: (img.exam_type as 'radiology' | 'ultrasound' | 'other') || 'other',
      radiologySub: (img.radiology_sub as 'thorax' | 'abdomen' | 'joint' | 'dental' | null) ?? null,
      briefComment: String(img.brief_comment || ''),
      hasNotableFinding: Boolean(img.has_notable_finding),
      storagePath: String(img.storage_path || ''),
      imageUrl: null,
      createdAt: new Date(String(img.created_at || new Date().toISOString())).toISOString(),
    })),
  };
}
