/**
 * 건강검진 리포트 초안-최종본 비교 분석 — 선택/해제/상태 조회.
 * admin-web 프록시 전용(차트앱 키 인증). 분석 실행은 병원 종료 트리거(send-kakao / export-by-share)에서.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { chartAppAuthMiddleware } from '@/lib/chart-app/auth';
import { isParseRunUuid } from '@/lib/chart-app/uuid';
import { getDiffStatus, selectRunForDiff, unselectRunForDiff } from '@/lib/chart-app/report-draft-diff';

export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<Response> {
  const authErr = chartAppAuthMiddleware(request);
  if (authErr) return authErr;

  const runId = request.nextUrl.searchParams.get('runId')?.trim() ?? '';
  if (!isParseRunUuid(runId)) return NextResponse.json({ error: 'runId invalid' }, { status: 400 });

  try {
    return NextResponse.json(await getDiffStatus(runId));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '조회 실패' }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  const authErr = chartAppAuthMiddleware(request);
  if (authErr) return authErr;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const runId = String(body.runId ?? '').trim();
  if (!isParseRunUuid(runId)) return NextResponse.json({ error: 'runId invalid' }, { status: 400 });
  const selected = body.selected !== false;
  const createdBy = String(body.createdBy ?? '').trim() || null;

  try {
    const out = selected ? await selectRunForDiff(runId, createdBy) : await unselectRunForDiff(runId);
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '처리 실패' }, { status: 500 });
  }
}
