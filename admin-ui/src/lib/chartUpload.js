function minDate(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a <= b ? a : b;
}

function maxDate(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

function groupBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const k = keyFn(row);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(row);
  }
  return map;
}

export function buildPreview(rows, errors) {
  const byDate = groupBy(rows, (r) => r.service_date);
  const patientSet = new Set(rows.map((r) => `${r.service_date}|${r.patient_key_norm}`));
  const range = rows.reduce(
    (acc, r) => ({
      startDate: minDate(acc.startDate, r.service_date),
      endDate: maxDate(acc.endDate, r.service_date),
    }),
    { startDate: null, endDate: null }
  );
  const amount = rows.reduce((sum, r) => sum + Number(r.final_amount_raw || 0), 0);
  return {
    totalRows: rows.length,
    errorRows: errors.length,
    startDate: range.startDate,
    endDate: range.endDate,
    uniqueVisitCount: patientSet.size,
    estimatedSalesAmount: amount,
    dateCount: byDate.size,
  };
}

async function insertUploadErrors(supabase, runId, hospitalId, chartType, errors) {
  if (!errors.length) return;
  const payload = errors.map((e) => ({
    run_id: runId,
    hospital_id: hospitalId,
    chart_type: chartType,
    source_row_no: e.source_row_no ?? null,
    error_code: e.error_code ?? null,
    error_message: e.error_message || "UNKNOWN",
    raw_payload: e.raw_payload || {},
  }));
  const { error } = await supabase.schema("analytics").from("chart_upload_errors").insert(payload);
  if (error) throw error;
}

async function upsertRawTransactions(supabase, runId, hospitalId, chartType, sourceFileName, sourceFileHash, rows) {
  if (!rows.length) return;
  const payload = rows.map((r) => ({
    run_id: runId,
    hospital_id: hospitalId,
    chart_type: chartType,
    source_file_name: sourceFileName,
    source_file_hash: sourceFileHash,
    source_row_no: r.source_row_no,
    row_signature: r.row_signature,
    service_date: r.service_date,
    customer_no_raw: r.customer_no_raw,
    customer_name_raw: r.customer_name_raw,
    patient_name_raw: r.patient_name_raw,
    final_amount_raw: r.final_amount_raw,
    customer_key_norm: r.customer_key_norm,
    patient_key_norm: r.patient_key_norm,
    raw_payload: r.raw_payload || {},
  }));
  const { error } = await supabase
    .schema("analytics")
    .from("chart_transactions_raw")
    .upsert(payload, { onConflict: "hospital_id,chart_type,source_file_hash,source_row_no" });
  if (error) throw error;
}

async function mergePatientMaster(supabase, hospitalId, chartType, rows) {
  if (!rows.length) return { inserted: 0, updated: 0 };
  const patientMap = new Map();
  for (const row of rows) {
    const key = row.patient_key_norm;
    const existing = patientMap.get(key);
    if (!existing) {
      patientMap.set(key, {
        patient_key_norm: key,
        customer_key_norm: row.customer_key_norm || null,
        patient_name_latest: row.patient_name_raw || null,
        customer_name_latest: row.customer_name_raw || null,
        first_visit_date: row.service_date,
        last_seen_date: row.service_date,
      });
      continue;
    }
    existing.first_visit_date = minDate(existing.first_visit_date, row.service_date);
    existing.last_seen_date = maxDate(existing.last_seen_date, row.service_date);
    existing.patient_name_latest = row.patient_name_raw || existing.patient_name_latest;
    existing.customer_name_latest = row.customer_name_raw || existing.customer_name_latest;
    existing.customer_key_norm = row.customer_key_norm || existing.customer_key_norm;
  }

  const patientKeys = [...patientMap.keys()];
  const existingMap = new Map();
  const pageSize = 500;
  for (let i = 0; i < patientKeys.length; i += pageSize) {
    const chunk = patientKeys.slice(i, i + pageSize);
    const { data, error } = await supabase
      .schema("analytics")
      .from("chart_patient_master")
      .select("patient_key_norm,first_visit_date,last_seen_at")
      .eq("hospital_id", hospitalId)
      .eq("chart_type", chartType)
      .in("patient_key_norm", chunk);
    if (error) throw error;
    for (const row of data || []) existingMap.set(row.patient_key_norm, row);
  }

  const nowIso = new Date().toISOString();
  const upserts = [];
  let inserted = 0;
  let updated = 0;
  for (const [patientKey, item] of patientMap.entries()) {
    const old = existingMap.get(patientKey);
    if (!old) inserted += 1;
    else updated += 1;
    upserts.push({
      hospital_id: hospitalId,
      chart_type: chartType,
      patient_key_norm: patientKey,
      customer_key_norm: item.customer_key_norm,
      patient_name_latest: item.patient_name_latest,
      customer_name_latest: item.customer_name_latest,
      first_visit_date: minDate(old?.first_visit_date || null, item.first_visit_date),
      last_seen_at: nowIso,
      is_active: true,
    });
  }

  if (upserts.length) {
    const { error } = await supabase
      .schema("analytics")
      .from("chart_patient_master")
      .upsert(upserts, { onConflict: "hospital_id,chart_type,patient_key_norm" });
    if (error) throw error;
  }

  return { inserted, updated };
}

async function upsertDailyKpis(supabase, runId, hospitalId, chartType, rows) {
  if (!rows.length) return { days: 0 };
  const dayMap = new Map();
  for (const row of rows) {
    const key = row.service_date;
    const entry = dayMap.get(key) || { sales_amount: 0, patientKeys: new Set() };
    entry.sales_amount += Number(row.final_amount_raw || 0);
    entry.patientKeys.add(row.patient_key_norm);
    dayMap.set(key, entry);
  }

  const dayRows = [...dayMap.entries()].map(([metricDate, info]) => ({
    metric_date: metricDate,
    hospital_id: hospitalId,
    chart_type: chartType,
    sales_amount: info.sales_amount,
    visit_count: info.patientKeys.size,
    source_run_id: runId,
  }));

  const minMetricDate = dayRows.reduce((a, b) => minDate(a, b.metric_date), null);
  const maxMetricDate = dayRows.reduce((a, b) => maxDate(a, b.metric_date), null);
  const { data: firstVisits, error: fvError } = await supabase
    .schema("analytics")
    .from("chart_patient_master")
    .select("first_visit_date")
    .eq("hospital_id", hospitalId)
    .eq("chart_type", chartType)
    .gte("first_visit_date", minMetricDate)
    .lte("first_visit_date", maxMetricDate);
  if (fvError) throw fvError;

  const newPatientCountByDate = new Map();
  for (const r of firstVisits || []) {
    const d = r.first_visit_date;
    newPatientCountByDate.set(d, (newPatientCountByDate.get(d) || 0) + 1);
  }

  const payload = dayRows.map((r) => ({
    ...r,
    new_patient_count: newPatientCountByDate.get(r.metric_date) || 0,
    metadata: {},
  }));
  const { error } = await supabase
    .schema("analytics")
    .from("chart_daily_kpis")
    .upsert(payload, { onConflict: "metric_date,hospital_id,chart_type" });
  if (error) throw error;

  return { days: payload.length };
}

export async function executeChartUpload({
  supabase,
  hospitalId,
  chartType,
  sourceFileName,
  sourceFileHash,
  parsedRows,
  parseErrors,
}) {
  const { data: runData, error: runError } = await supabase
    .schema("analytics")
    .from("chart_upload_runs")
    .upsert(
      {
        hospital_id: hospitalId,
        chart_type: chartType,
        source_file_name: sourceFileName,
        source_file_hash: sourceFileHash,
        status: "running",
        total_rows: parsedRows.length + parseErrors.length,
        imported_rows: 0,
        skipped_rows: 0,
        error_rows: parseErrors.length,
        started_at: new Date().toISOString(),
      },
      { onConflict: "hospital_id,chart_type,source_file_hash" }
    )
    .select("id")
    .single();
  if (runError) throw runError;
  const runId = runData.id;

  try {
    await insertUploadErrors(supabase, runId, hospitalId, chartType, parseErrors);
    await upsertRawTransactions(supabase, runId, hospitalId, chartType, sourceFileName, sourceFileHash, parsedRows);
    const patientResult = await mergePatientMaster(supabase, hospitalId, chartType, parsedRows);
    const kpiResult = await upsertDailyKpis(supabase, runId, hospitalId, chartType, parsedRows);

    const { error: doneError } = await supabase
      .schema("analytics")
      .from("chart_upload_runs")
      .update({
        status: "completed",
        imported_rows: parsedRows.length,
        skipped_rows: 0,
        error_rows: parseErrors.length,
        finished_at: new Date().toISOString(),
        metadata: {
          patient_inserted: patientResult.inserted,
          patient_updated: patientResult.updated,
          affected_days: kpiResult.days,
        },
      })
      .eq("id", runId);
    if (doneError) throw doneError;

    return {
      runId,
      importedRows: parsedRows.length,
      errorRows: parseErrors.length,
      patientInserted: patientResult.inserted,
      patientUpdated: patientResult.updated,
      affectedDays: kpiResult.days,
    };
  } catch (err) {
    await supabase
      .schema("analytics")
      .from("chart_upload_runs")
      .update({
        status: "failed",
        error_rows: parseErrors.length,
        finished_at: new Date().toISOString(),
        metadata: { failed_reason: String(err?.message || err) },
      })
      .eq("id", runId);
    throw err;
  }
}
