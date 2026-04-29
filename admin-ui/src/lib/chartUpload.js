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

function throwDbError(error, context) {
  if (!error) return;
  const details = [error.message, error.details, error.hint, error.code].filter(Boolean).join(" | ");
  throw new Error(`${context}: ${details || "Unknown database error"}`);
}

export function buildPreview(rows, errors) {
  const byDate = groupBy(rows, (r) => r.service_date);
  const knownRows = rows.filter((r) => !r.is_unknown_identity);
  const visitSet = new Set(knownRows.map((r) => `${r.service_date}|${r.customer_key_norm}|${r.patient_key_norm}`));
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
    uniqueVisitCount: visitSet.size,
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
  throwDbError(error, "chart_upload_errors insert");
}

async function updateRunProgress(supabase, runId, patch) {
  const { error } = await supabase
    .schema("analytics")
    .from("chart_upload_runs")
    .update(patch)
    .eq("id", runId);
  throwDbError(error, "chart_upload_runs update progress");
}

async function upsertRawTransactions(supabase, runId, hospitalId, chartType, sourceFileName, sourceFileHash, rows) {
  if (!rows.length) return;
  const usesDedupeKey = chartType === "intovet" || chartType === "woorien_pms" || chartType === "efriends";
  let effectiveRows = rows;
  if (usesDedupeKey) {
    // Postgres ON CONFLICT cannot update the same constrained key twice in one statement.
    // Collapse duplicate dedupe_key rows inside one upload payload, keeping the latest source row.
    const byDedupeKey = new Map();
    const passthrough = [];
    for (const row of rows) {
      const key = String(row?.dedupe_key || "").trim();
      if (!key) {
        passthrough.push(row);
        continue;
      }
      const old = byDedupeKey.get(key);
      if (!old || Number(row?.source_row_no || 0) >= Number(old?.source_row_no || 0)) {
        byDedupeKey.set(key, row);
      }
    }
    effectiveRows = [...passthrough, ...byDedupeKey.values()];
  }
  const payload = effectiveRows.map((r) => ({
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
    receipt_no_raw: r.receipt_no_raw ?? null,
    treatment_content_raw: r.treatment_content_raw ?? null,
    bill_no_raw: r.bill_no_raw ?? null,
    final_amount_raw: r.final_amount_raw,
    customer_key_norm: r.customer_key_norm,
    patient_key_norm: r.patient_key_norm,
    dedupe_key: r.dedupe_key ?? null,
    raw_payload: r.raw_payload || {},
  }));
  const onConflict = usesDedupeKey
    ? "hospital_id,chart_type,dedupe_key"
    : "hospital_id,chart_type,source_file_hash,source_row_no";
  const { error } = await supabase
    .schema("analytics")
    .from("chart_transactions_raw")
    .upsert(payload, { onConflict });
  throwDbError(error, "chart_transactions_raw upsert");
}

async function mergeCustomerMaster(supabase, hospitalId, chartType, rows) {
  if (!rows.length) return { inserted: 0, updated: 0 };
  const customerMap = new Map();
  for (const row of rows) {
    const key = row.customer_key_norm;
    const existing = customerMap.get(key);
    if (!existing) {
      customerMap.set(key, {
        customer_key_norm: key,
        customer_no_raw_latest: row.customer_no_raw || null,
        customer_name_latest: row.customer_name_raw || null,
        first_visit_date: row.service_date,
        last_seen_date: row.service_date,
      });
      continue;
    }
    existing.first_visit_date = minDate(existing.first_visit_date, row.service_date);
    existing.last_seen_date = maxDate(existing.last_seen_date, row.service_date);
    existing.customer_no_raw_latest = row.customer_no_raw || existing.customer_no_raw_latest;
    existing.customer_name_latest = row.customer_name_raw || existing.customer_name_latest;
  }

  const customerKeys = [...customerMap.keys()];
  const existingMap = new Map();
  // PostgREST query string can get too long with large IN lists.
  const pageSize = 100;
  for (let i = 0; i < customerKeys.length; i += pageSize) {
    const chunk = customerKeys.slice(i, i + pageSize);
    const { data, error } = await supabase
      .schema("analytics")
      .from("chart_customer_master")
      .select("customer_key_norm,first_visit_date")
      .eq("hospital_id", hospitalId)
      .eq("chart_type", chartType)
      .in("customer_key_norm", chunk);
    throwDbError(error, "chart_customer_master select existing");
    for (const row of data || []) existingMap.set(row.customer_key_norm, row);
  }

  const nowIso = new Date().toISOString();
  const upserts = [];
  let inserted = 0;
  let updated = 0;
  for (const [customerKey, item] of customerMap.entries()) {
    const old = existingMap.get(customerKey);
    if (!old) inserted += 1;
    else updated += 1;
    upserts.push({
      hospital_id: hospitalId,
      chart_type: chartType,
      customer_key_norm: customerKey,
      customer_no_raw_latest: item.customer_no_raw_latest,
      customer_name_latest: item.customer_name_latest,
      first_visit_date: minDate(old?.first_visit_date || null, item.first_visit_date),
      last_seen_at: nowIso,
      is_active: true,
    });
  }

  if (upserts.length) {
    const { error } = await supabase
      .schema("analytics")
      .from("chart_customer_master")
      .upsert(upserts, { onConflict: "hospital_id,chart_type,customer_key_norm" });
    throwDbError(error, "chart_customer_master upsert");
  }

  return { inserted, updated };
}

async function mergeCustomerPatients(supabase, hospitalId, chartType, rows) {
  if (!rows.length) return { inserted: 0, updated: 0 };
  const linkMap = new Map();
  for (const row of rows) {
    const linkKey = `${row.customer_key_norm}|${row.patient_key_norm}`;
    const existing = linkMap.get(linkKey);
    if (!existing) {
      linkMap.set(linkKey, {
        customer_key_norm: row.customer_key_norm,
        patient_key_norm: row.patient_key_norm,
        patient_name_latest: row.patient_name_raw || null,
        first_seen_date: row.service_date,
        last_seen_date: row.service_date,
      });
      continue;
    }
    existing.first_seen_date = minDate(existing.first_seen_date, row.service_date);
    existing.last_seen_date = maxDate(existing.last_seen_date, row.service_date);
    existing.patient_name_latest = row.patient_name_raw || existing.patient_name_latest;
  }

  const nowIso = new Date().toISOString();
  const upserts = [];
  for (const item of linkMap.values()) {
    upserts.push({
      hospital_id: hospitalId,
      chart_type: chartType,
      customer_key_norm: item.customer_key_norm,
      patient_key_norm: item.patient_key_norm,
      patient_name_latest: item.patient_name_latest,
      first_seen_date: item.first_seen_date,
      last_seen_date: item.last_seen_date,
      last_seen_at: nowIso,
      is_active: true,
    });
  }

  if (upserts.length) {
    const { error } = await supabase
      .schema("analytics")
      .from("chart_customer_patients")
      .upsert(upserts, { onConflict: "hospital_id,chart_type,customer_key_norm,patient_key_norm" });
    throwDbError(error, "chart_customer_patients upsert");
  }

  return { inserted: upserts.length, updated: 0 };
}

async function upsertDailyKpis(supabase, runId, hospitalId, chartType, rows) {
  if (!rows.length) return { days: 0 };
  const minMetricDate = rows.reduce((a, b) => minDate(a, b.service_date), null);
  const maxMetricDate = rows.reduce((a, b) => maxDate(a, b.service_date), null);
  if (!minMetricDate || !maxMetricDate) return { days: 0 };

  const { data: rawRows, error: rawError } = await supabase
    .schema("analytics")
    .from("chart_transactions_raw")
    .select("service_date,final_amount_raw,customer_key_norm,patient_key_norm,customer_name_raw,patient_name_raw")
    .eq("hospital_id", hospitalId)
    .eq("chart_type", chartType)
    .gte("service_date", minMetricDate)
    .lte("service_date", maxMetricDate);
  throwDbError(rawError, "chart_transactions_raw select for kpi rebuild");

  const dayMap = new Map();
  for (const row of rawRows || []) {
    const key = row.service_date;
    const entry = dayMap.get(key) || { sales_amount: 0, visitKeys: new Set() };
    entry.sales_amount += Number(row.final_amount_raw || 0);
    const isUnknownIdentity =
      row.customer_name_raw === "(고객명 미상)" || row.patient_name_raw === "(환자명 미상)";
    if (!isUnknownIdentity) {
      entry.visitKeys.add(`${row.customer_key_norm}|${row.patient_key_norm}`);
    }
    dayMap.set(key, entry);
  }

  // Rebuild entire uploaded date range, including dates with now-empty raw rows.
  let cursorDate = minMetricDate;
  while (cursorDate <= maxMetricDate) {
    if (!dayMap.has(cursorDate)) {
      dayMap.set(cursorDate, { sales_amount: 0, visitKeys: new Set() });
    }
    const next = new Date(`${cursorDate}T00:00:00.000Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    cursorDate = next.toISOString().slice(0, 10);
  }

  const dayRows = [...dayMap.entries()].map(([metricDate, info]) => ({
    metric_date: metricDate,
    hospital_id: hospitalId,
    chart_type: chartType,
    sales_amount: info.sales_amount,
    visit_count: info.visitKeys.size,
    source_run_id: runId,
  }));

  const newCustomerCountByDate = new Map();
  const { data: firstVisits, error: fvError } = await supabase
    .schema("analytics")
    .from("chart_customer_master")
    .select("first_visit_date")
    .eq("hospital_id", hospitalId)
    .eq("chart_type", chartType)
    .gte("first_visit_date", minMetricDate)
    .lte("first_visit_date", maxMetricDate);
  throwDbError(fvError, "chart_customer_master select first_visit");
  for (const r of firstVisits || []) {
    const d = r.first_visit_date;
    newCustomerCountByDate.set(d, (newCustomerCountByDate.get(d) || 0) + 1);
  }

  const payload = dayRows.map((r) => ({
    ...r,
    new_customer_count: newCustomerCountByDate.get(r.metric_date) || 0,
    metadata: {},
  }));
  const { error } = await supabase
    .schema("analytics")
    .from("chart_daily_kpis")
    .upsert(payload, { onConflict: "metric_date,hospital_id,chart_type" });
  throwDbError(error, "chart_daily_kpis upsert");

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
  // Auto-repair stale "running" runs for this hospital/chart so KPIs don't stay inconsistent.
  const { error: repairError } = await supabase
    .schema("analytics")
    .rpc("repair_stale_chart_runs", { p_hospital_id: hospitalId, p_chart_type: chartType });
  // Ignore repair errors; the current run should still attempt to proceed.
  if (repairError) {
    // best effort only
  }

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
  throwDbError(runError, "chart_upload_runs upsert running");
  const runId = runData.id;
  let currentStage = "started";

  try {
    currentStage = "inserting_errors";
    await updateRunProgress(supabase, runId, {
      metadata: { stage: currentStage },
    });
    await insertUploadErrors(supabase, runId, hospitalId, chartType, parseErrors);

    currentStage = "upserting_raw";
    await updateRunProgress(supabase, runId, {
      metadata: { stage: currentStage },
    });
    await upsertRawTransactions(supabase, runId, hospitalId, chartType, sourceFileName, sourceFileHash, parsedRows);

    // Rebuild master/link/kpis from raw inside DB for strong consistency.
    currentStage = "rebuild_in_db";
    await updateRunProgress(supabase, runId, {
      metadata: { stage: currentStage },
    });
    const { data: rebuildResult, error: rebuildError } = await supabase
      .schema("analytics")
      .rpc("rebuild_chart_for_run", { p_run_id: runId });
    throwDbError(rebuildError, "rebuild_chart_for_run rpc");

    currentStage = "finalizing";
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
          stage: "completed",
          rebuild: rebuildResult || {},
        },
      })
      .eq("id", runId);
    throwDbError(doneError, "chart_upload_runs update completed");

    return {
      runId,
      importedRows: parsedRows.length,
      errorRows: parseErrors.length,
      customerInserted: rebuildResult?.customer_upserts ?? 0,
      customerUpdated: 0,
      customerPatientLinkInserted: rebuildResult?.link_upserts ?? 0,
      customerPatientLinkUpdated: 0,
      affectedDays: rebuildResult?.kpi_days ?? 0,
    };
  } catch (err) {
    await supabase
      .schema("analytics")
      .from("chart_upload_runs")
      .update({
        status: "failed",
        error_rows: parseErrors.length,
        finished_at: new Date().toISOString(),
        metadata: {
          stage: currentStage,
          failed_reason: String(err?.message || err),
        },
      })
      .eq("id", runId);
    throw new Error(`[${currentStage}] ${String(err?.message || err)}`);
  }
}
