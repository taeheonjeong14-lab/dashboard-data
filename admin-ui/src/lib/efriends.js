import * as XLSX from "xlsx";

const EFRIENDS_CHART_TYPE = "efriends";
const EFRIENDS_MIN_COLS = {
  serviceDate: 5, // F
  ownerAndPatients: 7, // H
  amount: 10, // K (금액)
};

function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function makeUnknownName(raw, placeholder) {
  return normalizeText(raw) || placeholder;
}

function amountToNumber(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const cleaned = String(value)
    .replace(/[,\s]/g, "")
    .replace(/[₩원]/g, "")
    .trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function ymdToYmd(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const ymdMatch = raw.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/);
  if (ymdMatch) {
    const [, y, m, d] = ymdMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const t = Date.parse(raw);
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  return null;
}

function normalizeCustomerKeyFromName(name) {
  return normalizeText(name)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

async function sha256Hex(input) {
  const enc = new TextEncoder();
  const data = enc.encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const view = new Uint8Array(digest);
  return Array.from(view).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function parseOwnerPatientsText(text) {
  const t = normalizeText(text);
  if (!t) return { ownerName: "", patientText: "" };

  if (t === "[RETAIL SALES]") {
    return { ownerName: "[RETAIL SALES]", patientText: "" };
  }

  const normalizeOwnerName = (raw) => {
    let s = normalizeText(raw);
    // Remove trailing comma used as separator before patient list: "고객명, (환자...)".
    s = s.replace(/\s*,\s*$/, "");
    // Normalize comma spacing for multi-owner: "a,b" -> "a, b"
    s = s.replace(/\s*,\s*/g, ", ");
    return s;
  };

  const lastOpen = t.lastIndexOf("(");
  const lastClose = t.lastIndexOf(")");
  if (lastOpen !== -1 && lastClose !== -1 && lastOpen < lastClose) {
    const ownerPart = t.slice(0, lastOpen);
    const patientPart = t.slice(lastOpen + 1, lastClose);
    return { ownerName: normalizeOwnerName(ownerPart), patientText: normalizeText(patientPart) };
  }

  return { ownerName: normalizeOwnerName(t), patientText: "" };
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        const next = line[i + 1];
        if (next === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function parseCsv(text) {
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((l) => l.length > 0);
  return lines.map(parseCsvLine);
}

function findTrailingTotalRowIndex(rows) {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const serviceDate = ymdToYmd(row[EFRIENDS_MIN_COLS.serviceDate]);
    const ownerText = normalizeText(row[EFRIENDS_MIN_COLS.ownerAndPatients]);
    const amount = amountToNumber(row[EFRIENDS_MIN_COLS.amount]);
    if (!serviceDate && !ownerText && amount !== 0) return i;
  }
  return -1;
}

async function decodeFileTextWithFallback(file) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const encodings = ["utf-8", "utf-8-sig", "euc-kr", "windows-949"];
  for (const enc of encodings) {
    try {
      const dec = new TextDecoder(enc, { fatal: true });
      return dec.decode(bytes);
    } catch {
      // try next
    }
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

export async function parseEFriendsFile(file, hospitalId) {
  const name = String(file?.name || "").toLowerCase();
  const isCsv = name.endsWith(".csv");

  const parsedRows = [];
  const errors = [];

  let rows;
  let sheetName;

  if (isCsv) {
    const text = await decodeFileTextWithFallback(file);
    rows = parseCsv(text);
    sheetName = "csv";
  } else {
    const bytes = await file.arrayBuffer();
    const workbook = XLSX.read(bytes, { type: "array", cellDates: true });
    sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new Error("엑셀 시트를 찾을 수 없습니다.");
    const sheet = workbook.Sheets[sheetName];
    rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
  }

  if (!rows?.length) throw new Error("파일 데이터가 비어 있습니다.");
  const trailingTotalRowIndex = findTrailingTotalRowIndex(rows);

  for (let i = 0; i < rows.length; i += 1) {
    // First row is header.
    if (i === 0) continue;
    if (i === trailingTotalRowIndex) continue;

    const row = rows[i];
    if (!Array.isArray(row) || row.length <= EFRIENDS_MIN_COLS.ownerAndPatients) continue;

    const rowNo = i + 1;
    const serviceDate = ymdToYmd(row[EFRIENDS_MIN_COLS.serviceDate]);
    const ownerTextRaw = normalizeText(row[EFRIENDS_MIN_COLS.ownerAndPatients]);
    const finalAmountRaw = amountToNumber(row[EFRIENDS_MIN_COLS.amount]);

    if (!serviceDate && !ownerTextRaw && finalAmountRaw === 0) continue;

    if (!serviceDate) {
      errors.push({
        source_row_no: rowNo,
        error_code: "INVALID_REQUIRED_FIELD",
        error_message: "필수값(F:일자)이 비어 있습니다.",
        raw_payload: { row },
      });
      continue;
    }

    const { ownerName, patientText } = parseOwnerPatientsText(ownerTextRaw);
    const isRetailSales = ownerName === "[RETAIL SALES]";
    const isUnknownIdentity = isRetailSales || !ownerName;

    const customerName = isUnknownIdentity ? "(고객명 미상)" : makeUnknownName(ownerName, "(고객명 미상)");
    // eFriends patient identity isn't reliable; store parsed patient text for reference only.
    const patientName = isUnknownIdentity ? "(환자명 미상)" : makeUnknownName(patientText, "(환자명 미상)");

    const customerKeyBase = isUnknownIdentity
      ? `${hospitalId}|${EFRIENDS_CHART_TYPE}|unknown|${serviceDate}|${rowNo}`
      : `${hospitalId}|${EFRIENDS_CHART_TYPE}|${normalizeCustomerKeyFromName(customerName)}`;
    const customerKeyNorm = await sha256Hex(customerKeyBase);

    // IMPORTANT: for eFriends we intentionally DO NOT increase visit_count by patient.
    // Collapse patient key to be stable per customer so (customer|patient) uniqueness == customer uniqueness.
    const patientKeyNorm = await sha256Hex(`${hospitalId}|${EFRIENDS_CHART_TYPE}|visit|${customerKeyNorm}`);

    const rowSignature = await sha256Hex(
      `${hospitalId}|${EFRIENDS_CHART_TYPE}|${serviceDate}|${customerKeyNorm}|${finalAmountRaw}|${rowNo}`
    );

    parsedRows.push({
      source_row_no: rowNo,
      service_date: serviceDate,
      customer_no_raw: null,
      customer_name_raw: customerName,
      patient_name_raw: patientName,
      final_amount_raw: finalAmountRaw,
      customer_key_norm: customerKeyNorm,
      patient_key_norm: patientKeyNorm,
      is_unknown_identity: isUnknownIdentity,
      row_signature: rowSignature,
      raw_payload: { row },
    });
  }

  return {
    chartType: EFRIENDS_CHART_TYPE,
    sheetName,
    rows: parsedRows,
    errors,
  };
}

