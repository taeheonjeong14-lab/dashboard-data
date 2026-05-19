import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

export async function GET(request: NextRequest) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const runId = request.nextUrl.searchParams.get('runId');

  try {
    const supabase = createServiceRoleClient();
    const db = supabase.schema('chart_pdf');

    const query = db
      .from('parse_runs')
      .select('id, created_at, friendly_id, status, raw_payload, chart_type:documents(chart_type), file_name:documents(file_name)');

    const { data: run, error } = runId
      ? await query.eq('id', runId).maybeSingle()
      : await query.order('created_at', { ascending: false }).limit(1).maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!run) return NextResponse.json({ run: null });

    const payload = run.raw_payload as Record<string, unknown> | null;

    type RawLine = { page?: number; text?: string };
    type RawLabItem = { itemName?: string; valueText?: string; unit?: string | null; referenceRange?: string | null; flag?: string; page?: number };
    type RawChartGroup = { dateTime?: string; bodyText?: string; planText?: string; planDetected?: boolean; lineCount?: number };
    type RawLabDateGroup = { dateTime?: string; items?: RawLabItem[] };

    const rawBucketed = payload?.bucketed as Record<string, RawLine[]> | null | undefined;
    const rawChartBodyByDate = payload?.chartBodyByDate as RawChartGroup[] | null | undefined;
    const rawLabItems = payload?.labItems as RawLabItem[] | null | undefined;
    const rawLabItemsByDate = payload?.labItemsByDate as RawLabDateGroup[] | null | undefined;

    return NextResponse.json({
      run: {
        id: run.id,
        createdAt: run.created_at,
        friendlyId: run.friendly_id,
        status: run.status,
        chartType: (payload?.chartType as string | null) ?? null,
        fileName: Array.isArray(run.file_name) ? (run.file_name[0] as Record<string, unknown> | null)?.file_name : null,
      },
      chartBodyByDate: (rawChartBodyByDate ?? []).map((g) => ({
        dateTime: g.dateTime ?? '',
        bodyText: g.bodyText ?? '',
        planText: g.planText ?? '',
        planDetected: g.planDetected ?? false,
        lineCount: g.lineCount ?? 0,
      })),
      bucketLines: {
        chartBody: (rawBucketed?.chartBody ?? []).map((l) => `p${l.page ?? 0}: ${l.text ?? ''}`),
        lab: (rawBucketed?.lab ?? []).map((l) => `p${l.page ?? 0}: ${l.text ?? ''}`),
        basicInfo: (rawBucketed?.basicInfo ?? []).map((l) => `p${l.page ?? 0}: ${l.text ?? ''}`),
        vitals: (rawBucketed?.vitals ?? []).map((l) => `p${l.page ?? 0}: ${l.text ?? ''}`),
      },
      labItems: (rawLabItems ?? []).map((item) => ({
        itemName: item.itemName ?? '',
        valueText: item.valueText ?? '',
        unit: item.unit ?? null,
        referenceRange: item.referenceRange ?? null,
        flag: item.flag ?? 'unknown',
        page: item.page ?? 0,
      })),
      labItemsByDate: (rawLabItemsByDate ?? []).map((g) => ({
        dateTime: g.dateTime ?? '',
        items: (g.items ?? []).map((item) => ({
          itemName: item.itemName ?? '',
          valueText: item.valueText ?? '',
          unit: item.unit ?? null,
          flag: item.flag ?? 'unknown',
        })),
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
