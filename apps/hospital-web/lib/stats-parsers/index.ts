import * as XLSX from 'xlsx';

export type DailyKpi = {
  metric_date: string;
  sales_amount: number;
  visit_count: number;
};

export type ParseResult = {
  kpis: DailyKpi[];
  rowCount: number;
  dateFrom: string | null;
  dateTo: string | null;
};

function parseDate(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number' && isFinite(value)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (XLSX.SSF as any).parse_date_code(value) as { y?: number; m?: number; d?: number } | null;
    if (p?.y && p?.m && p?.d)
      return `${String(p.y).padStart(4, '0')}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  const m = raw.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`;
  const t = Date.parse(raw);
  if (!isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  return null;
}

function toAmount(value: unknown): number {
  if (value == null || value === '') return 0;
  if (typeof value === 'number' && isFinite(value)) return value;
  const n = Number(String(value).replace(/[,\s₩원]/g, '').trim());
  return isFinite(n) ? n : 0;
}

function aggregate(rows: { date: string; amount: number; visitKey: string }[]): DailyKpi[] {
  const map = new Map<string, { sales: number; visits: Set<string> }>();
  for (const row of rows) {
    if (!row.date) continue;
    const e = map.get(row.date) ?? { sales: 0, visits: new Set<string>() };
    e.sales += row.amount;
    e.visits.add(row.visitKey);
    map.set(row.date, e);
  }
  return [...map.entries()].map(([date, { sales, visits }]) => ({
    metric_date: date,
    sales_amount: sales,
    visit_count: visits.size,
  }));
}

function finalize(rows: { date: string; amount: number; visitKey: string }[], rawCount: number): ParseResult {
  const kpis = aggregate(rows);
  const dates = kpis.map((k) => k.metric_date).sort();
  return { kpis, rowCount: rawCount, dateFrom: dates[0] ?? null, dateTo: dates[dates.length - 1] ?? null };
}

export function parseIntoVet(buffer: ArrayBuffer): ParseResult {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]!]!;
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null });
  const data = rows.slice(2); // 2 header rows
  const parsed: { date: string; amount: number; visitKey: string }[] = [];
  for (const row of data) {
    const r = row as unknown[];
    const date = parseDate(r[0]);
    if (!date) continue;
    parsed.push({
      date,
      amount: toAmount(r[70]), // BS column (default amount)
      visitKey: `${String(r[1] ?? '').trim()}|${String(r[3] ?? '').trim()}`,
    });
  }
  return finalize(parsed, parsed.length);
}

export function parseWoorienPms(buffer: ArrayBuffer): ParseResult {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]!]!;
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null });
  const data = rows.slice(1); // 1 header row
  const parsed: { date: string; amount: number; visitKey: string }[] = [];
  for (const row of data) {
    const r = row as unknown[];
    const date = parseDate(r[0]);
    if (!date) continue;
    parsed.push({
      date,
      amount: toAmount(r[11]), // L column
      visitKey: `${String(r[1] ?? '').trim()}|${String(r[3] ?? '').trim()}`,
    });
  }
  return finalize(parsed, parsed.length);
}

export function parseEFriends(buffer: ArrayBuffer): ParseResult {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]!]!;
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null });
  // eFriends has variable header rows — find first data row by date in col 5
  let startRow = 1;
  for (let i = 0; i < Math.min(6, rows.length); i++) {
    if (parseDate((rows[i] as unknown[])[5])) { startRow = i; break; }
  }
  const data = rows.slice(startRow);
  const parsed: { date: string; amount: number; visitKey: string }[] = [];
  for (const row of data) {
    const r = row as unknown[];
    const date = parseDate(r[5]); // F column
    if (!date) continue;
    parsed.push({
      date,
      amount: toAmount(r[10]), // K column
      visitKey: `${String(r[6] ?? '').trim()}|${String(r[7] ?? '').trim()}`,
    });
  }
  return finalize(parsed, parsed.length);
}
