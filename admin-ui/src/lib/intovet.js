import * as XLSX from "xlsx";

const INTO_VET_CHART_TYPE = "intovet";
const INTO_VET_MIN_COLS = {
  serviceDate: 0, // A
  customerNo: 1, // B
  customerName: 2, // C
  patientName: 3, // D
  finalAmount: 70, // BS
};

function excelDateToYmd(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      return `${String(parsed.y).padStart(4, "0")}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
    }
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const ymdMatch = raw.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/);
  if (ymdMatch) {
    const [, y, m, d] = ymdMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const mdYMatch = raw.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/);
  if (mdYMatch) {
    const [, m, d, y] = mdYMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const t = Date.parse(raw);
  if (!Number.isNaN(t)) {
    return new Date(t).toISOString().slice(0, 10);
  }

  return null;
}

function amountToNumber(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const cleaned = String(value).replace(/[,\s]/g, "").trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeCustomerKey(customerNoRaw) {
  return normalizeText(customerNoRaw).toLowerCase();
}

function normalizePatientName(patientNameRaw) {
  return normalizeText(patientNameRaw).toLowerCase();
}

async function sha256Hex(input) {
  const enc = new TextEncoder();
  const data = enc.encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const view = new Uint8Array(digest);
  return Array.from(view).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function fileToSha256(file) {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const view = new Uint8Array(digest);
  return Array.from(view).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function parseIntoVetWorkbook(file, hospitalId) {
  const bytes = await file.arrayBuffer();
  const workbook = XLSX.read(bytes, { type: "array", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("엑셀 시트를 찾을 수 없습니다.");
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
  if (!rows.length) throw new Error("엑셀 데이터가 비어 있습니다.");

  const parsedRows = [];
  const errors = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!Array.isArray(row) || row.length <= INTO_VET_MIN_COLS.patientName) continue;

    const serviceDate = excelDateToYmd(row[INTO_VET_MIN_COLS.serviceDate]);
    const customerNoRaw = normalizeText(row[INTO_VET_MIN_COLS.customerNo]);
    const customerNameRaw = normalizeText(row[INTO_VET_MIN_COLS.customerName]);
    const patientNameRaw = normalizeText(row[INTO_VET_MIN_COLS.patientName]);
    const finalAmountRaw = amountToNumber(row[INTO_VET_MIN_COLS.finalAmount]);

    const rowNo = i + 1;

    // Skip probable header rows.
    if (!serviceDate && !customerNoRaw && !patientNameRaw && finalAmountRaw === 0) continue;

    if (!serviceDate || !patientNameRaw) {
      errors.push({
        source_row_no: rowNo,
        error_code: "INVALID_REQUIRED_FIELD",
        error_message: "필수값(A:일자, D:환자명)이 비어 있습니다.",
        raw_payload: { row },
      });
      continue;
    }

    const customerKeyNorm = normalizeCustomerKey(customerNoRaw);
    const patientBase = `${hospitalId}|${INTO_VET_CHART_TYPE}|${customerKeyNorm}|${normalizePatientName(patientNameRaw)}`;
    const patientKeyNorm = await sha256Hex(patientBase);
    const rowSignature = await sha256Hex(
      `${hospitalId}|${INTO_VET_CHART_TYPE}|${serviceDate}|${customerKeyNorm}|${patientNameRaw}|${finalAmountRaw}|${rowNo}`
    );

    parsedRows.push({
      source_row_no: rowNo,
      service_date: serviceDate,
      customer_no_raw: customerNoRaw || null,
      customer_name_raw: customerNameRaw || null,
      patient_name_raw: patientNameRaw,
      final_amount_raw: finalAmountRaw,
      customer_key_norm: customerKeyNorm,
      patient_key_norm: patientKeyNorm,
      row_signature: rowSignature,
      raw_payload: { row },
    });
  }

  return {
    chartType: INTO_VET_CHART_TYPE,
    sheetName,
    rows: parsedRows,
    errors,
  };
}
