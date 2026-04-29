import * as XLSX from "xlsx";

const INTO_VET_CHART_TYPE = "intovet";
const INTO_VET_MIN_COLS = {
  serviceDate: 0, // A
  customerNo: 1, // B
  customerName: 2, // C
  patientName: 3, // D
  receiptNo: 5, // F
  finalAmount: 70, // BS
};
const INTO_VET_HEADER_ROW_COUNT = 2;

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
  return String(customerNoRaw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9_-]/g, "");
}

function normalizePatientName(patientNameRaw) {
  return normalizeText(patientNameRaw).toLowerCase();
}

function normalizeOwnerName(ownerNameRaw) {
  return normalizeText(ownerNameRaw).toLowerCase();
}

function normalizeReceiptNo(receiptNoRaw) {
  return String(receiptNoRaw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9_-]/g, "");
}

function makeUnknownName(raw, placeholder) {
  return normalizeText(raw) || placeholder;
}

function hasAnyNumberCell(row) {
  if (!Array.isArray(row)) return false;
  return row.some((cell) => {
    if (typeof cell === "number") return Number.isFinite(cell);
    const text = String(cell ?? "").replace(/[,\s]/g, "").trim();
    if (!text) return false;
    return Number.isFinite(Number(text));
  });
}

function findTrailingTotalRowIndex(rows) {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const customerNoRaw = normalizeText(row[INTO_VET_MIN_COLS.customerNo]);
    const customerNameRaw = normalizeText(row[INTO_VET_MIN_COLS.customerName]);
    const patientNameRaw = normalizeText(row[INTO_VET_MIN_COLS.patientName]);
    if (!customerNoRaw && !customerNameRaw && !patientNameRaw && hasAnyNumberCell(row)) {
      return i;
    }
  }
  return -1;
}

async function sha256Hex(input) {
  const enc = new TextEncoder();
  const data = enc.encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const view = new Uint8Array(digest);
  return Array.from(view).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function fileToSha256(source) {
  const buf = source instanceof ArrayBuffer ? source : await source.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const view = new Uint8Array(digest);
  return Array.from(view).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function parseIntoVetWorkbook(source, hospitalId) {
  const bytes = source instanceof ArrayBuffer ? source : await source.arrayBuffer();
  const workbook = XLSX.read(bytes, { type: "array", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("엑셀 시트를 찾을 수 없습니다.");
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
  if (!rows.length) throw new Error("엑셀 데이터가 비어 있습니다.");
  const trailingTotalRowIndex = findTrailingTotalRowIndex(rows);

  const parsedRows = [];
  const errors = [];

  for (let i = 0; i < rows.length; i += 1) {
    // IntoVet export has two header rows at the top.
    if (i < INTO_VET_HEADER_ROW_COUNT) continue;
    // The trailing numeric summary row is total, not transaction data.
    if (i === trailingTotalRowIndex) continue;

    const row = rows[i];
    if (!Array.isArray(row) || row.length <= INTO_VET_MIN_COLS.patientName) continue;

    const serviceDate = excelDateToYmd(row[INTO_VET_MIN_COLS.serviceDate]);
    const customerNoRaw = normalizeText(row[INTO_VET_MIN_COLS.customerNo]);
    const customerNameRaw = normalizeText(row[INTO_VET_MIN_COLS.customerName]);
    const patientNameRaw = normalizeText(row[INTO_VET_MIN_COLS.patientName]);
    const receiptNoRaw = normalizeText(row[INTO_VET_MIN_COLS.receiptNo]);
    const finalAmountRaw = amountToNumber(row[INTO_VET_MIN_COLS.finalAmount]);

    const rowNo = i + 1;

    // Skip probable header rows.
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

    // Unknown identity rows should never contribute to unique customer counting.
    // Generate keys without relying on B(customer_no) so the assigned number is ignored.
    const customerKeyBase = isUnknownIdentity
      ? `${hospitalId}|${INTO_VET_CHART_TYPE}|unknown|${serviceDate}|${rowNo}`
      : `${hospitalId}|${INTO_VET_CHART_TYPE}|${normalizedCustomerNo}`;
    const customerKeyNorm = await sha256Hex(customerKeyBase);
    const patientBase = `${hospitalId}|${INTO_VET_CHART_TYPE}|${customerKeyNorm}|${normalizePatientName(effectivePatientName)}|${rowNo}`;
    const patientKeyNorm = await sha256Hex(patientBase);
    const normalizedReceiptNo = normalizeReceiptNo(receiptNoRaw);
    const dedupeKey =
      normalizedCustomerNo && customerNameRaw && normalizedReceiptNo
        ? `${serviceDate}|${normalizedCustomerNo}|${normalizeOwnerName(customerNameRaw)}|${normalizedReceiptNo}|${finalAmountRaw}`
        : null;
    const rowSignature = await sha256Hex(
      `${hospitalId}|${INTO_VET_CHART_TYPE}|${serviceDate}|${customerKeyNorm}|${effectivePatientName}|${finalAmountRaw}|${rowNo}`
    );

    parsedRows.push({
      source_row_no: rowNo,
      service_date: serviceDate,
      customer_no_raw: customerNoRaw || null,
      customer_name_raw: effectiveCustomerName,
      patient_name_raw: effectivePatientName,
      receipt_no_raw: receiptNoRaw || null,
      final_amount_raw: finalAmountRaw,
      customer_key_norm: customerKeyNorm,
      patient_key_norm: patientKeyNorm,
      dedupe_key: dedupeKey,
      is_unknown_identity: isUnknownIdentity,
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
