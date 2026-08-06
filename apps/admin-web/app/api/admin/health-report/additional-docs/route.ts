import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { isParseRunUuid } from '@/lib/chart-extraction/uuid';

export const dynamic = 'force-dynamic';

type PatchBody = {
  runId?: string;
  /** 편집 가능한 필드만. 저장된 배열과 같은 순서·같은 길이여야 한다. */
  docs?: { text?: unknown; summary?: unknown }[];
};

/**
 * PATCH — 추가 자료(외부 검사 결과서 등)의 LLM 추출 텍스트를 admin 이 수기 교정해 저장한다.
 *
 * 추가 자료는 blog_case payload 안의 `additional_docs` 배열에 들어 있고, 같은 payload 에 케이스개요
 * (`overview`)도 함께 산다. 그래서 payload 통째 upsert(=/health-report/content PATCH)를 쓰면 개요가
 * 날아간다 → 여기서 읽어서 병합해 쓴다. 파일 자체의 식별 정보(path·bucket·filename·mime_type)와
 * 추출 실패 표시(error)는 서버가 보존하고, 클라이언트가 보낸 text·summary 만 덮어쓴다.
 *
 * 길이가 다르면 409 — 편집하는 사이 재추출이 돌아 문서 구성이 바뀐 경우이고, 그대로 쓰면 엉뚱한
 * 파일에 남의 텍스트가 붙는다.
 */
export async function PATCH(request: NextRequest) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const runId = String(body.runId ?? '').trim();
  if (!isParseRunUuid(runId)) return NextResponse.json({ error: 'runId invalid' }, { status: 400 });
  if (!Array.isArray(body.docs)) return NextResponse.json({ error: 'docs must be an array' }, { status: 400 });
  const incoming = body.docs;

  try {
    const sb = createServiceRoleClient();
    const { data: row, error: readErr } = await sb
      .schema('health_report')
      .from('generated_run_content')
      .select('payload')
      .eq('parse_run_id', runId)
      .eq('content_type', 'blog_case')
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);

    const payload =
      row?.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
        ? (row.payload as Record<string, unknown>)
        : null;
    const stored = Array.isArray(payload?.additional_docs)
      ? (payload.additional_docs as Record<string, unknown>[])
      : null;
    if (!payload || !stored) {
      return NextResponse.json({ error: '이 run 에는 추가 자료가 없습니다.' }, { status: 404 });
    }
    if (stored.length !== incoming.length) {
      return NextResponse.json(
        { error: '추가 자료 구성이 바뀌었습니다(재추출 등). 화면을 새로고침한 뒤 다시 편집해 주세요.' },
        { status: 409 },
      );
    }

    const merged = stored.map((doc, i) => {
      const edit = incoming[i] ?? {};
      const next = { ...doc };
      if (typeof edit.text === 'string') next.text = edit.text;
      if (typeof edit.summary === 'string') next.summary = edit.summary;
      return next;
    });

    const { error: writeErr } = await sb
      .schema('health_report')
      .from('generated_run_content')
      .upsert(
        {
          parse_run_id: runId,
          content_type: 'blog_case',
          payload: { ...payload, additional_docs: merged },
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'parse_run_id,content_type' },
      );
    if (writeErr) throw new Error(writeErr.message);

    return NextResponse.json({ ok: true, count: merged.length });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '추가 자료 저장에 실패했습니다.' },
      { status: 500 },
    );
  }
}
