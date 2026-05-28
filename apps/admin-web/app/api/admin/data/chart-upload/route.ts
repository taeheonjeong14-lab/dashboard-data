import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { formatSupabaseError } from '@/lib/format-supabase-error';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { executeChartUpload, type ParsedTxnRow, type ParseError } from '@dashboard/chart-ingest';

export const maxDuration = 300;

type Body = {
  hospitalId: string;
  chartType: string;
  sourceFileName: string;
  sourceFileHash: string;
  parsedRows: ParsedTxnRow[];
  parseErrors: ParseError[];
};

export async function POST(request: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { hospitalId, chartType, sourceFileName, sourceFileHash, parsedRows, parseErrors } =
    body;
  if (!hospitalId?.trim() || !chartType || !sourceFileName || !sourceFileHash) {
    return NextResponse.json({ error: 'hospitalId, chartType, sourceFileName, sourceFileHash 필수' }, { status: 400 });
  }

  try {
    const supabase = createServiceRoleClient();
    const result = await executeChartUpload({
      supabase,
      hospitalId: hospitalId.trim(),
      chartType,
      sourceFileName,
      sourceFileHash,
      parsedRows,
      parseErrors,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: formatSupabaseError(e) }, { status: 500 });
  }
}
