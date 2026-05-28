export type ChartType = "intovet" | "woorien_pms" | "efriends";

export type ParseSource =
  | ArrayBuffer
  | File
  | { bytes: ArrayBuffer; name?: string };

export type ParsedTxnRow = {
  source_row_no: number;
  service_date: string;
  customer_no_raw: string | null;
  customer_name_raw: string;
  patient_name_raw: string;
  receipt_no_raw: string | null;
  treatment_content_raw?: string | null;
  bill_no_raw?: string | null;
  final_amount_raw: number;
  customer_key_norm: string;
  patient_key_norm: string;
  dedupe_key: string | null;
  is_unknown_identity: boolean;
  row_signature: string;
  raw_payload: Record<string, unknown>;
};

export type ParseError = {
  source_row_no?: number | null;
  error_code?: string | null;
  error_message: string;
  raw_payload?: Record<string, unknown>;
};

export type ParseOutput = {
  chartType: string;
  sheetName: string;
  rows: ParsedTxnRow[];
  errors: ParseError[];
};

export function parseIntoVetWorkbook(
  source: ParseSource,
  hospitalId: string,
  options?: { amountColumn?: string },
): Promise<ParseOutput>;

export function parseWoorienPmsWorkbook(
  source: ParseSource,
  hospitalId: string,
): Promise<ParseOutput>;

export function parseEFriendsFile(
  source: ParseSource,
  hospitalId: string,
): Promise<ParseOutput>;

export function fileToSha256(
  source: ArrayBuffer | { arrayBuffer(): Promise<ArrayBuffer> },
): Promise<string>;

export type ChartUploadResult = {
  runId: string;
  importedRows: number;
  parsedRows: number;
  errorRows: number;
  customerInserted: number;
  customerUpdated: number;
  customerPatientLinkInserted: number;
  customerPatientLinkUpdated: number;
  affectedDays: number;
};

export function executeChartUpload(args: {
  // supabase service-role client (typed as unknown to stay client-lib agnostic)
  supabase: unknown;
  hospitalId: string;
  chartType: string;
  sourceFileName: string;
  sourceFileHash: string;
  parsedRows: ParsedTxnRow[];
  parseErrors: ParseError[];
}): Promise<ChartUploadResult>;

export function buildPreview(
  rows: ParsedTxnRow[],
  errors: ParseError[],
): {
  totalRows: number;
  errorRows: number;
  startDate: string | null;
  endDate: string | null;
  uniqueVisitCount: number;
  estimatedSalesAmount: number;
  dateCount: number;
};

export function collapseRowsForDedupeUpload(
  chartType: string,
  rows: ParsedTxnRow[],
): ParsedTxnRow[];
