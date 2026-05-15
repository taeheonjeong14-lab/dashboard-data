import type pg from 'pg';
import { createHash, randomBytes } from 'crypto';

import type { ChartKind } from '@/lib/chart-app/chart-kind';
import {
  finalizeBasicInfoBirthAndAge,
} from '@/lib/patient-birth-age';
import { assignFriendlyIdToParseRun } from '@/lib/friendly-id';
import { parsePlanRows } from '@/lib/text-bucketing/parse-helpers';
import type {
  ParsedBasicInfo,
  ParsedVitalRow,
  ParsedPhysicalExamItem,
  ChartBodyByDateGroup,
} from '@/lib/text-bucketing/parse-helpers';
import type { ParsedVaccinationRecord } from '@/lib/text-bucketing/vaccination-parse';
import { findNearestChartRowId } from '@/lib/text-bucketing/parse-helpers';

export type BucketingRunResult = {
  runId: string;
  friendlyId: string;
  documentId: string;
};

const RAW_PAYLOAD_MAX_EXTRA_CHARS = 80_000;

/**
 * documents + parse_runs(+ friendly_id) + 빈 result_basic_info 행.
 * vet-report 텍스트 버킷팅 후 히스토리·추출 PATCH 에 필요한 runId 를 반환합니다.
 */
export async function createParseRunAfterBucketing(
  client: pg.PoolClient,
  params: {
    fileName: string;
    fileHash: string;
    chartType: ChartKind;
    hospitalId: string;
    storageBucket: string | null;
    storagePath: string | null;
    buckets: Record<string, string>;
    numPages: number;
    textLength: number;
    truncated: boolean;
    chartPasteText?: string;
    efriendsChartBlocks?: unknown;
  },
): Promise<BucketingRunResult> {
  const docIns = await client.query<{ id: string }>(
    `INSERT INTO chart_pdf.documents (file_name, file_hash, chart_type) VALUES ($1, $2, $3) RETURNING id`,
    [params.fileName, params.fileHash, params.chartType],
  );
  const documentId = docIns.rows[0].id;

  const paste =
    params.chartPasteText && params.chartPasteText.length > RAW_PAYLOAD_MAX_EXTRA_CHARS
      ? params.chartPasteText.slice(0, RAW_PAYLOAD_MAX_EXTRA_CHARS)
      : params.chartPasteText;

  const rawPayload = {
    source: 'text-bucketing',
    chartType: params.chartType,
    hospitalId: params.hospitalId,
    storageBucket: params.storageBucket,
    storagePath: params.storagePath,
    chartPasteText: paste ?? null,
    efriendsChartBlocks: params.efriendsChartBlocks ?? null,
    buckets: params.buckets,
    numPages: params.numPages,
    textLength: params.textLength,
    truncated: params.truncated,
  };

  const modelLabel = process.env.GEMINI_MODEL?.trim() || 'gemini-2.0-flash';

  for (let attempt = 0; attempt < 8; attempt++) {
    const friendlyId = `tb_${randomBytes(8).toString('hex')}`;
    try {
      const runIns = await client.query<{ id: string }>(
        `
        INSERT INTO chart_pdf.parse_runs (
          document_id, status, provider, model, raw_payload, friendly_id, hospital_id
        ) VALUES (
          $1::uuid, 'success', 'chart-api', $2, $3::jsonb, $4, $5::uuid
        )
        RETURNING id
        `,
        [documentId, modelLabel, JSON.stringify(rawPayload), friendlyId, params.hospitalId],
      );
      const runId = runIns.rows[0].id;

      await client.query(`INSERT INTO chart_pdf.result_basic_info (parse_run_id) VALUES ($1::uuid)`, [runId]);

      return { runId, friendlyId, documentId };
    } catch (e: unknown) {
      const err = e as { code?: string };
      if (err.code === '23505') continue;
      throw e;
    }
  }

  throw new Error('Could not allocate unique friendly_id');
}

export function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

// ─── Hospital row helper ─────────────────────────────────────────────────────

type CoreHospitalRow = {
  id: string;
  name: string | null;
  code: string | null;
  slug: string | null;
};

async function loadCoreHospitalRowPg(
  client: pg.PoolClient,
  hospitalId: string,
): Promise<CoreHospitalRow> {
  const { rows } = await client.query<{
    id: string;
    name: string | null;
    code: string | null;
    slug: string | null;
  }>(
    `SELECT id, name, code, slug FROM public.hospitals WHERE id = $1::uuid LIMIT 1`,
    [hospitalId],
  );
  const row = rows[0];
  if (!row) {
    throw new Error(
      `병원 정보를 찾을 수 없습니다: hospitals 에서 id=${hospitalId} 가 없습니다.`,
    );
  }
  return {
    id: row.id,
    name: row.name ?? null,
    code: row.code ?? null,
    slug: row.slug ?? null,
  };
}

// ─── saveFullParseRun ─────────────────────────────────────────────────────────

export type SaveFullParseRunParams = {
  client: pg.PoolClient;
  fileName: string;
  fileBuffer: Buffer;
  chartType: ChartKind;
  provider: string;
  model: string;
  parserVersion: string;
  rawPayload: unknown;
  chartBodyByDate: Array<{
    dateTime: string;
    bodyText: string;
    planText: string;
    planDetected: boolean;
  }>;
  labItemsByDate: Array<{
    dateTime: string;
    items: Array<{
      itemName: string;
      rawItemName: string;
      valueText: string;
      unit: string | null;
      referenceRange: string | null;
      flag: 'low' | 'high' | 'normal' | 'unknown';
    }>;
  }>;
  vaccinationRecords: ParsedVaccinationRecord[];
  vitals: ParsedVitalRow[];
  physicalExamItems: ParsedPhysicalExamItem[];
  basicInfoParsed: ParsedBasicInfo;
  hospitalId: string;
};

export async function saveFullParseRun(
  params: SaveFullParseRunParams,
): Promise<{ runId: string; friendlyId: string }> {
  const { client } = params;

  const hospitalRow = await loadCoreHospitalRowPg(client, params.hospitalId);

  const fileHash = createHash('sha256').update(params.fileBuffer).digest('hex');

  // 1. Insert document
  const docIns = await client.query<{ id: string }>(
    `INSERT INTO chart_pdf.documents (file_name, file_hash, chart_type) VALUES ($1, $2, $3) RETURNING id`,
    [params.fileName, fileHash, params.chartType],
  );
  const documentId = docIns.rows[0].id;

  // 2. Insert parse_run
  const runIns = await client.query<{ id: string; created_at: string }>(
    `INSERT INTO chart_pdf.parse_runs
       (document_id, hospital_id, status, provider, model, parser_version, raw_payload, error_message)
     VALUES ($1::uuid, $2::uuid, 'success', $3, $4, $5, $6::jsonb, null)
     RETURNING id, created_at`,
    [
      documentId,
      hospitalRow.id,
      params.provider,
      params.model,
      params.parserVersion,
      JSON.stringify(params.rawPayload),
    ],
  );
  const parseRunId = runIns.rows[0].id;
  const runCreatedAt = runIns.rows[0].created_at;

  // 3. Insert chart_by_date rows
  let chartRowsInserted: Array<{ id: string; date_time: string; row_order: number | null }> = [];
  if (params.chartBodyByDate.length > 0) {
    const vals: unknown[] = [];
    const placeholders: string[] = [];
    let idx = 1;
    for (let i = 0; i < params.chartBodyByDate.length; i++) {
      const g = params.chartBodyByDate[i];
      placeholders.push(`($${idx++}::uuid, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`);
      vals.push(parseRunId, g.dateTime, g.bodyText, g.planText, g.planDetected, i);
    }
    const chartIns = await client.query<{ id: string; date_time: string; row_order: number }>(
      `INSERT INTO chart_pdf.result_chart_by_date
         (parse_run_id, date_time, body_text, plan_text, plan_detected, row_order)
       VALUES ${placeholders.join(', ')}
       RETURNING id, date_time, row_order`,
      vals,
    );
    chartRowsInserted = chartIns.rows;
  }

  // 4. Insert lab items
  const labRows = params.labItemsByDate.flatMap((group, groupIndex) =>
    group.items.map((item, itemIndex) => ({
      dateTime: group.dateTime,
      itemName: item.itemName,
      rawItemName: item.rawItemName,
      valueText: item.valueText,
      unit: item.unit,
      referenceRange: item.referenceRange,
      flag: item.flag,
      rowOrder: groupIndex * 1000 + itemIndex,
    })),
  );
  if (labRows.length > 0) {
    const vals: unknown[] = [];
    const placeholders: string[] = [];
    let idx = 1;
    for (const r of labRows) {
      placeholders.push(
        `($${idx++}::uuid, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`,
      );
      vals.push(
        parseRunId, r.dateTime, r.itemName, r.rawItemName,
        r.valueText, r.unit, r.referenceRange, r.flag, r.rowOrder,
      );
    }
    await client.query(
      `INSERT INTO chart_pdf.result_lab_items
         (parse_run_id, date_time, item_name, raw_item_name, value_text, unit, reference_range, flag, row_order)
       VALUES ${placeholders.join(', ')}`,
      vals,
    );
  }

  // 5. Insert vaccination records
  if (params.vaccinationRecords.length > 0) {
    const vals: unknown[] = [];
    const placeholders: string[] = [];
    let idx = 1;
    for (let i = 0; i < params.vaccinationRecords.length; i++) {
      const r = params.vaccinationRecords[i];
      placeholders.push(
        `($${idx++}::uuid, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`,
      );
      vals.push(
        parseRunId, r.recordType, r.doseOrder, r.productName,
        r.administeredDate, r.sign, i,
      );
    }
    await client.query(
      `INSERT INTO chart_pdf.result_vaccination_records
         (parse_run_id, record_type, dose_order, product_name, administered_date, sign, row_order)
       VALUES ${placeholders.join(', ')}`,
      vals,
    );
  }

  // 6. Insert vitals
  if (params.vitals.length > 0) {
    const chartDateRefs = chartRowsInserted.map((c) => ({ id: c.id, date_time: c.date_time }));
    const vals: unknown[] = [];
    const placeholders: string[] = [];
    let idx = 1;
    for (let i = 0; i < params.vitals.length; i++) {
      const row = params.vitals[i];
      const chartByDateId = findNearestChartRowId(row.dateTime, chartDateRefs, 20);
      placeholders.push(
        `($${idx++}::uuid, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`,
      );
      vals.push(
        parseRunId, chartByDateId, row.dateTime,
        row.weight, row.temperature, row.respiratoryRate,
        row.heartRate, row.bpSystolic, row.bpDiastolic,
        row.rawText, i,
      );
    }
    await client.query(
      `INSERT INTO chart_pdf.result_vitals
         (parse_run_id, chart_by_date_id, date_time, weight, temperature, respiratory_rate,
          heart_rate, bp_systolic, bp_diastolic, raw_text, row_order)
       VALUES ${placeholders.join(', ')}`,
      vals,
    );
  }

  // 7. Insert physical exam items (graceful fallback if table missing)
  if (params.physicalExamItems.length > 0) {
    const chartDateRefs = chartRowsInserted.map((c) => ({ id: c.id, date_time: c.date_time }));
    const vals: unknown[] = [];
    const placeholders: string[] = [];
    let idx = 1;
    for (let i = 0; i < params.physicalExamItems.length; i++) {
      const item = params.physicalExamItems[i];
      const chartByDateId = findNearestChartRowId(item.dateTime, chartDateRefs, 20);
      placeholders.push(
        `($${idx++}::uuid, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`,
      );
      vals.push(
        parseRunId, chartByDateId, item.dateTime,
        item.itemName, item.referenceRange, item.valueText,
        item.unit, item.rawText, i,
      );
    }
    try {
      await client.query(
        `INSERT INTO chart_pdf.result_physical_exam_items
           (parse_run_id, chart_by_date_id, date_time, item_name, reference_range, value_text,
            unit, raw_text, row_order)
         VALUES ${placeholders.join(', ')}`,
        vals,
      );
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      const msg = err.message ?? '';
      const missingTable =
        /result_physical_exam_items/i.test(msg) &&
        /(does not exist|undefined_table|relation)/i.test(msg);
      if (!missingTable) {
        throw new Error(`result_physical_exam_items insert failed: ${msg}`);
      }
      console.warn(
        '[saveFullParseRun] result_physical_exam_items table is missing; skipping physical exam item persistence.',
      );
    }
  }

  // 8. Insert plan rows
  const planRows = chartRowsInserted.flatMap((row, groupIndex) => {
    const matched = params.chartBodyByDate.find((g) => g.dateTime === row.date_time);
    if (!matched || !matched.planText.trim()) return [];
    return parsePlanRows(matched.planText, params.chartType).map((plan, itemIndex) => ({
      parseRunId,
      chartByDateId: row.id,
      code: plan.code || null,
      treatmentPrescription: plan.treatmentPrescription || null,
      qty: plan.qty || null,
      unit: plan.unit || null,
      day: plan.day || null,
      total: plan.total || null,
      route: plan.route || null,
      signId: plan.signId || null,
      rawText: plan.raw,
      rowOrder: groupIndex * 1000 + itemIndex,
    }));
  });
  if (planRows.length > 0) {
    const vals: unknown[] = [];
    const placeholders: string[] = [];
    let idx = 1;
    for (const r of planRows) {
      placeholders.push(
        `($${idx++}::uuid, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`,
      );
      vals.push(
        r.parseRunId, r.chartByDateId, r.code, r.treatmentPrescription,
        r.qty, r.unit, r.day, r.total, r.route, r.signId, r.rawText, r.rowOrder,
      );
    }
    await client.query(
      `INSERT INTO chart_pdf.result_plan_rows
         (parse_run_id, chart_by_date_id, code, treatment_prescription, qty, unit, day, total,
          route, sign_id, raw_text, row_order)
       VALUES ${placeholders.join(', ')}`,
      vals,
    );
  }

  // 9. Insert basic_info
  const basicFinal = finalizeBasicInfoBirthAndAge(params.chartType, params.basicInfoParsed, {
    chartBodyByDate: params.chartBodyByDate,
    labItemsByDate: params.labItemsByDate,
    runCreatedAtIso: runCreatedAt,
  });

  await client.query(
    `INSERT INTO chart_pdf.result_basic_info
       (parse_run_id, hospital_name, owner_name, patient_name, species, breed, birth, age, sex)
     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      parseRunId,
      hospitalRow.name ?? '',
      basicFinal.ownerName,
      basicFinal.patientName,
      basicFinal.species,
      basicFinal.breed,
      basicFinal.birth,
      basicFinal.age,
      basicFinal.sex,
    ],
  );

  // 10. Assign friendly_id
  const slug = (hospitalRow.code ?? hospitalRow.slug) ?? '';
  const friendlyId = await assignFriendlyIdToParseRun(client, parseRunId, runCreatedAt, {
    hospitalId: hospitalRow.id,
    hospitalSlug: slug,
  });

  return { runId: parseRunId, friendlyId };
}
