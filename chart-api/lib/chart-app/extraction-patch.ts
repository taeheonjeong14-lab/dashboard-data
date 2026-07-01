import type pg from 'pg';
import { canonicalizeLabItemName, canonicalizeLabUnit } from '@/lib/chart-app/lab-item-normalize';
import { speciesProfileFromBasicSpecies } from '@/lib/chart-app/lab-species-profile';
import { chartByDateIdForDateTime, getParseRun } from '@/lib/chart-app/run-queries';

export class ChartApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
  }
}

function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  return String(v);
}

function num(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

type BasicInfoPayload = Record<string, unknown>;

async function upsertBasicInfo(client: pg.PoolClient, runId: string, basicInfo: BasicInfoPayload) {
  const { rows: prevRows } = await client.query(
    `SELECT * FROM chart_pdf.result_basic_info WHERE parse_run_id = $1::uuid LIMIT 1`,
    [runId],
  );
  const prev = (prevRows[0] ?? {}) as Record<string, unknown>;

  const hospital_name =
    basicInfo.hospitalName !== undefined ? str(basicInfo.hospitalName) : str(prev.hospital_name);
  const owner_name = basicInfo.ownerName !== undefined ? str(basicInfo.ownerName) : str(prev.owner_name);
  const patient_name =
    basicInfo.patientName !== undefined ? str(basicInfo.patientName) : str(prev.patient_name);
  const species = basicInfo.species !== undefined ? str(basicInfo.species) : str(prev.species);
  const breed = basicInfo.breed !== undefined ? str(basicInfo.breed) : str(prev.breed);
  const birth = basicInfo.birth !== undefined ? str(basicInfo.birth) : str(prev.birth);
  const sex = basicInfo.sex !== undefined ? str(basicInfo.sex) : str(prev.sex);
  const age = basicInfo.age !== undefined ? num(basicInfo.age) : num(prev.age);

  await client.query(
    `
    INSERT INTO chart_pdf.result_basic_info (
      parse_run_id, hospital_name, owner_name, patient_name, species, breed, birth, sex, age
    ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (parse_run_id) DO UPDATE SET
      hospital_name = EXCLUDED.hospital_name,
      owner_name = EXCLUDED.owner_name,
      patient_name = EXCLUDED.patient_name,
      species = EXCLUDED.species,
      breed = EXCLUDED.breed,
      birth = EXCLUDED.birth,
      sex = EXCLUDED.sex,
      age = EXCLUDED.age
    `,
    [runId, hospital_name, owner_name, patient_name, species, breed, birth, sex, age],
  );
}

async function patchVaccination(client: pg.PoolClient, runId: string, records: unknown[]) {
  if (!Array.isArray(records)) throw new Error('records must be an array');
  for (const r of records) {
    const row = r as Record<string, unknown>;
    const id = str(row.id);
    if (!id) throw new Error('vaccination records require id');
    const record_type = str(row.recordType);
    const dose_order = str(row.doseOrder);
    const product_name = str(row.productName);
    if (!record_type || !dose_order || !product_name) {
      throw new Error('vaccination row missing recordType, doseOrder, or productName');
    }
    const administered_date =
      row.administeredDate !== undefined ? str(row.administeredDate) : null;
    const sign = row.sign !== undefined ? str(row.sign) : null;

    const upd = await client.query(
      `
      UPDATE chart_pdf.result_vaccination_records
      SET record_type = $3, dose_order = $4, product_name = $5,
          administered_date = $6, sign = $7
      WHERE id = $1::uuid AND parse_run_id = $2::uuid
      `,
      [id, runId, record_type, dose_order, product_name, administered_date, sign],
    );
    if (upd.rowCount === 0) throw new Error(`vaccination record not found: ${id}`);
  }
}

async function patchChartBody(client: pg.PoolClient, runId: string, bodies: unknown[]) {
  if (!Array.isArray(bodies)) throw new Error('bodies must be an array');
  for (const b of bodies) {
    const row = b as Record<string, unknown>;
    const id = str(row.id);
    const bodyText = row.bodyText !== undefined ? str(row.bodyText) : null;
    if (!id) throw new Error('chartBody items require id');
    const upd = await client.query(
      `UPDATE chart_pdf.result_chart_by_date SET body_text = $3 WHERE id = $1::uuid AND parse_run_id = $2::uuid`,
      [id, runId, bodyText],
    );
    if (upd.rowCount === 0) throw new Error(`chart_by_date row not found: ${id}`);
  }
}

function planRawText(row: Record<string, unknown>): string {
  const parts = [
    str(row.code),
    str(row.treatmentPrescription),
    str(row.qty),
    str(row.unit),
    str(row.day),
    str(row.total),
    str(row.route),
    str(row.signId),
  ].filter(Boolean);
  return parts.join(' | ') || '{}';
}

async function patchPlan(client: pg.PoolClient, runId: string, body: Record<string, unknown>) {
  const deletedRowIds = body.deletedRowIds as unknown;
  if (deletedRowIds !== undefined) {
    if (!Array.isArray(deletedRowIds)) throw new Error('deletedRowIds must be array');
    for (const rid of deletedRowIds) {
      const id = str(rid);
      if (!id) continue;
      await client.query(
        `DELETE FROM chart_pdf.result_plan_rows WHERE id = $1::uuid AND parse_run_id = $2::uuid`,
        [id, runId],
      );
    }
  }

  const rows = body.rows as unknown;
  if (!Array.isArray(rows)) return;

  for (const pr of rows) {
    const row = pr as Record<string, unknown>;
    const id = row.id !== undefined ? str(row.id) : null;
    const dateTime = str(row.dateTime);

    if (id) {
      const upd = await client.query(
        `
        UPDATE chart_pdf.result_plan_rows SET
          code = $3,
          treatment_prescription = $4,
          qty = $5,
          unit = $6,
          "day" = $7,
          total = $8,
          route = $9,
          sign_id = $10,
          raw_text = $11
        WHERE id = $1::uuid AND parse_run_id = $2::uuid
        `,
        [
          id,
          runId,
          str(row.code),
          str(row.treatmentPrescription),
          str(row.qty),
          str(row.unit),
          str(row.day),
          str(row.total),
          str(row.route),
          str(row.signId),
          planRawText(row),
        ],
      );
      if (upd.rowCount === 0) throw new Error(`plan row not found: ${id}`);
      continue;
    }

    if (!dateTime) throw new Error('plan insert requires dateTime when id is omitted');
    const chartByDateId = await chartByDateIdForDateTime(client, runId, dateTime);
    if (!chartByDateId) {
      throw new Error(`no result_chart_by_date for dateTime=${dateTime}`);
    }

    await client.query(
      `
      INSERT INTO chart_pdf.result_plan_rows (
        parse_run_id, chart_by_date_id, code, treatment_prescription, qty, unit, "day", total, route, sign_id, raw_text, row_order
      ) VALUES (
        $1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11,
        COALESCE((SELECT MAX(p.row_order) + 1 FROM chart_pdf.result_plan_rows p WHERE p.parse_run_id = $1::uuid), 0)
      )
      `,
      [
        runId,
        chartByDateId,
        str(row.code),
        str(row.treatmentPrescription),
        str(row.qty),
        str(row.unit),
        str(row.day),
        str(row.total),
        str(row.route),
        str(row.signId),
        planRawText(row),
      ],
    );
  }
}

const LAB_FLAGS = new Set(['low', 'high', 'normal', 'unknown']);

/** UI 우선순위: rawItemName → raw_item_name → itemName → item_name (합의와 동일) */
function labRawDisplayNameForPatch(row: Record<string, unknown>): string | null {
  const raw = str(row.rawItemName ?? row.raw_item_name)?.trim();
  if (raw) return raw;
  const name = str(row.itemName ?? row.item_name)?.trim();
  return name || null;
}

function labValueTextForPatch(row: Record<string, unknown>): string {
  if (row.valueText !== undefined) return str(row.valueText) ?? '';
  if (row.value_text !== undefined) return str(row.value_text) ?? '';
  return '';
}

function labReferenceRangeForPatch(row: Record<string, unknown>): string | null {
  if (row.referenceRange !== undefined) return str(row.referenceRange);
  if (row.reference_range !== undefined) return str(row.reference_range);
  return null;
}

function labDateTimeForPatch(row: Record<string, unknown>): string | null {
  return str(row.dateTime ?? row.date_time);
}

async function patchLab(client: pg.PoolClient, runId: string, body: Record<string, unknown>) {
  const deletedItemIds = body.deletedItemIds as unknown;
  if (deletedItemIds !== undefined) {
    if (!Array.isArray(deletedItemIds)) throw new Error('deletedItemIds must be array');
    for (const did of deletedItemIds) {
      const id = str(did);
      if (!id) continue;
      await client.query(
        `DELETE FROM chart_pdf.result_lab_items WHERE id = $1::uuid AND parse_run_id = $2::uuid`,
        [id, runId],
      );
    }
  }

  const items = body.items as unknown;
  if (!Array.isArray(items)) return;

  const { rows: speciesRows } = await client.query<{ species: string | null }>(
    `SELECT species FROM chart_pdf.result_basic_info WHERE parse_run_id = $1::uuid LIMIT 1`,
    [runId],
  );
  const labSpecies = speciesProfileFromBasicSpecies(speciesRows[0]?.species);

  for (const it of items) {
    const row = it as Record<string, unknown>;
    const id = row.id !== undefined ? str(row.id) : null;
    const dateTime = labDateTimeForPatch(row);
    const rawDisplay = labRawDisplayNameForPatch(row);
    const valueText = labValueTextForPatch(row);
    const flagRaw = str(row.flag);
    const flag = flagRaw && LAB_FLAGS.has(flagRaw) ? flagRaw : 'unknown';
    const unit = canonicalizeLabUnit(row.unit !== undefined ? str(row.unit) : null);
    const referenceRange = labReferenceRangeForPatch(row);

    if (!rawDisplay) throw new Error('lab itemName or rawItemName required');

    const canonicalName = canonicalizeLabItemName(rawDisplay, labSpecies) || rawDisplay;

    if (id) {
      const upd = await client.query(
        `
        UPDATE chart_pdf.result_lab_items SET
          date_time = COALESCE($3, date_time),
          item_name = $4,
          raw_item_name = $5,
          value_text = $6,
          flag = $7,
          unit = $8,
          reference_range = $9
        WHERE id = $1::uuid AND parse_run_id = $2::uuid
        `,
        [id, runId, dateTime, canonicalName, rawDisplay, valueText, flag, unit, referenceRange],
      );
      if (upd.rowCount === 0) throw new Error(`lab item not found: ${id}`);
      continue;
    }

    await client.query(
      `
      INSERT INTO chart_pdf.result_lab_items (
        parse_run_id, date_time, item_name, raw_item_name, value_text, flag, unit, reference_range, row_order
      ) VALUES (
        $1::uuid, $2, $3, $4, $5, $6, $7, $8,
        COALESCE((SELECT MAX(l.row_order) + 1 FROM chart_pdf.result_lab_items l WHERE l.parse_run_id = $1::uuid), 0)
      )
      `,
      [runId, dateTime, canonicalName, rawDisplay, valueText, flag, unit, referenceRange],
    );
  }
}

export async function handleExtractionPatch(
  client: pg.PoolClient,
  runId: string,
  body: Record<string, unknown>,
): Promise<void> {
  const run = await getParseRun(client, runId);
  if (!run) throw new ChartApiError('run not found', 404);

  const section = str(body.section);
  if (!section) throw new Error('section is required');

  switch (section) {
    case 'basicInfo': {
      const basicInfo = body.basicInfo as BasicInfoPayload | undefined;
      if (!basicInfo || typeof basicInfo !== 'object') throw new Error('basicInfo object required');
      await upsertBasicInfo(client, runId, basicInfo);
      return;
    }
    case 'vaccination': {
      await patchVaccination(client, runId, body.records as unknown[]);
      return;
    }
    case 'chartBody': {
      await patchChartBody(client, runId, body.bodies as unknown[]);
      return;
    }
    case 'plan': {
      await patchPlan(client, runId, body);
      return;
    }
    case 'lab': {
      await patchLab(client, runId, body);
      return;
    }
    default:
      throw new Error(`unsupported section: ${section}`);
  }
}
