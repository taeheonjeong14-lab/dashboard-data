/**
 * 진료케이스 블로그 초안-확정본 비교 분석 실행 트리거.
 * admin-web 프록시 전용(차트앱 키 인증) — 담당자가 4단계에서 '확정' 을 누를 때 1회 호출된다.
 * BEFORE 스냅샷은 blog_post 전체 생성 시 chart-api 가 자동으로 남긴다(여기서 만들지 않는다).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { chartAppAuthMiddleware } from '@/lib/chart-app/auth';
import { isParseRunUuid } from '@/lib/chart-app/uuid';
import { runBlogDiffAnalysisOnConfirm } from '@/lib/chart-app/blog-draft-diff';

export const runtime = 'nodejs';
/** LLM 분석이 들어가므로 기본 타임아웃으로는 모자랄 수 있다. */
export const maxDuration = 300;

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

  try {
    await runBlogDiffAnalysisOnConfirm(runId, body.finalPayload ?? {});
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '처리 실패' }, { status: 500 });
  }
}
