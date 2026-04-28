import * as XLSX from "xlsx";

const WOORIEN_PMS_CHART_TYPE = "woorien_pms";
const WOORIEN_PMS_MIN_COLS = {
  serviceDate: 0, // A
  customerNo: 1, // B
  customerName: 2, // C
  patientName: 3, // D
  finalAmount: 11, // L
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
  const ymd = raw.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/);
  if (ymd) {
    const [, y, m, d] = ymd;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const mdY = raw.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/);
  if (mdY) {
    const [, m, d, y] = mdY;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const t = Date.parse(raw);
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
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
  return String(customerNoRaw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9_-]/g, "");
}

function normalizePatientName(patientNameRaw) {
  return normalizeText(patientNameRaw).toLowerCase();
}

function makeUnknownName(raw, placeholder) {
  return normalizeText(raw) || placeholder;
}

async function sha256Hex(input) {
  const enc = new TextEncoder();
  const data = enc.encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const view = new Uint8Array(digest);
  return Array.from(view).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function parseWoorienPmsWorkbook(file, hospitalId) {
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
    // Woorien PMS has a single header row at top.
    if (i === 0) continue;

    const row = rows[i];
    if (!Array.isArray(row) || row.length <= WOORIEN_PMS_MIN_COLS.patientName) continue;

    const serviceDate = excelDateToYmd(row[WOORIEN_PMS_MIN_COLS.serviceDate]);
    const customerNoRaw = normalizeText(row[WOORIEN_PMS_MIN_COLS.customerNo]);
    const customerNameRaw = normalizeText(row[WOORIEN_PMS_MIN_COLS.customerName]);
    const patientNameRaw = normalizeText(row[WOORIEN_PMS_MIN_COLS.patientName]);
    const finalAmountRaw = amountToNumber(row[WOORIEN_PMS_MIN_COLS.finalAmount]);
    const rowNo = i + 1;

    if (!serviceDate && !customerNoRaw && !patientNameRaw && finalAmountRaw === 0) continue;
    if (!serviceDate) {
      errors.push({
        source_row_no: rowNo,
        error_code: "INVALID_REQUIRED_FIELD",
        error_message: "필수값(A:일자)이 비어 있습니다.",
        raw_payload: { row },
      });
      continue;
    }

    const isUnknownIdentity = !customerNameRaw || !patientNameRaw;
    const effectiveCustomerName = makeUnknownName(customerNameRaw, "(고객명 미상)");
    const effectivePatientName = makeUnknownName(patientNameRaw, "(환자명 미상)");

    const normalizedCustomerNo = normalizeCustomerKey(customerNoRaw);
    if (!isUnknownIdentity && !normalizedCustomerNo) {
      errors.push({
        source_row_no: rowNo,
        error_code: "INVALID_CUSTOMER_NO",
        error_message: "필수값(B:고객번호)이 비어 있거나 유효하지 않습니다.",
        raw_payload: { row },
      });
      continue;
    }

    const customerKeyBase = isUnknownIdentity
      ? `${hospitalId}|${WOORIEN_PMS_CHART_TYPE}|unknown|${serviceDate}|${rowNo}`
      : `${hospitalId}|${WOORIEN_PMS_CHART_TYPE}|${normalizedCustomerNo}`;
    const customerKeyNorm = await sha256Hex(customerKeyBase);
    const patientBase = `${hospitalId}|${WOORIEN_PMS_CHART_TYPE}|${customerKeyNorm}|${normalizePatientName(effectivePatientName)}|${rowNo}`;
    const patientKeyNorm = await sha256Hex(patientBase);
    const rowSignature = await sha256Hex(
      `${hospitalId}|${WOORIEN_PMS_CHART_TYPE}|${serviceDate}|${customerKeyNorm}|${effectivePatientName}|${finalAmountRaw}|${rowNo}`
    );

    parsedRows.push({
      source_row_no: rowNo,
      service_date: serviceDate,
      customer_no_raw: customerNoRaw || null,
      customer_name_raw: effectiveCustomerName,
      patient_name_raw: effectivePatientName,
      final_amount_raw: finalAmountRaw,
      customer_key_norm: customerKeyNorm,
      patient_key_norm: patientKeyNorm,
      is_unknown_identity: isUnknownIdentity,
      row_signature: rowSignature,
      raw_payload: { row },
    });
  }

  return {
    chartType: WOORIEN_PMS_CHART_TYPE,
    sheetName,
    rows: parsedRows,
    errors,
  };
}
