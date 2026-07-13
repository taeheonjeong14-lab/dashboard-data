/**
 * 블로그 글 검수 — 전용 라우트. 내부(위저드, runId 기반)·외부(admin, 지정 병원) 공통.
 * 3모델 앙상블 + 집계(chart-app/blog-review) → 신호등·게이트 판정(@dashboard/blog-review-rubric).
 * 과금 feature='blog_review' → product 'case_blog' 자동 → 바른플랜 환불. 설계: docs/blog-review-spec.md
 */
import { NextResponse, type NextRequest } from 'next/server';
import type pg from 'pg';
import { chartAppAuthMiddleware } from '@/lib/chart-app/auth';
import { getChartPgPool } from '@/lib/db';
import { chargeOperationTokens, hospitalHasTokens } from '@/lib/billing/token-charge';
import { upsertGeneratedRunContent } from '@/lib/chart-app/generated-content';
import { isParseRunUuid } from '@/lib/chart-app/uuid';
import { runBlogReviewEnsemble } from '@/lib/chart-app/blog-review';
import {
  assembleReview,
  computeSeoMetrics,
  deriveInternalKeyword,
  type Keyword,
  type ReviewInput,
  type SourceType,
} from '@dashboard/blog-review-rubric';

export const runtime = 'nodejs';
export const maxDuration = 300; // 리뷰어 3 + 집계 1 = 4호출이라 넉넉히

type OverviewItem = { label?: unknown; value?: unknown };

/** caseOverview(=[{label,value}]) 에서 label 이 keyword 를 포함하는 항목의 value. */
function findOverview(overview: unknown, keyword: string): string {
  if (!Array.isArray(overview)) return '';
  const hit = (overview as OverviewItem[]).find((x) => String(x?.label ?? '').includes(keyword));
  return hit ? String(hit.value ?? '').trim() : '';
}

/** core.hospitals 에서 병원명·지역(주소 앞 2토큰) 로드. blog_post 라우트와 동일 방식. */
async function loadHospitalInfo(
  pool: pg.Pool,
  hospitalId: string | null,
): Promise<{ name: string; region: string }> {
  if (!hospitalId) return { name: '', region: '' };
  try {
    const { rows } = await pool.query<{ name: string | null; address: string | null }>(
      `SELECT name, address FROM core.hospitals WHERE id::text = $1 LIMIT 1`,
      [hospitalId],
    );
    const name = (rows[0]?.name ?? '').trim();
    const addr = (rows[0]?.address ?? '').trim();
    const region = addr ? addr.split(/\s+/).slice(0, 2).join(' ') : '';
    return { name, region };
  } catch {
    return { name: '', region: '' };
  }
}

/** 외부 검수 이력 저장. 테이블 미존재 시 무시(저장은 부가 기능). */
async function saveExternalReview(
  pool: pg.Pool,
  params: { sourceUrl: string; inputText: string; hospitalId: string | null; createdBy: string | null; review: unknown },
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO health_report.blog_reviews (source_type, source_url, input_text, hospital_id, created_by, report)
       VALUES ('external', $1, $2, $3, $4, $5::jsonb)`,
      [
        params.sourceUrl || null,
        params.inputText.slice(0, 200_000),
        params.hospitalId,
        params.createdBy,
        JSON.stringify(params.review ?? {}),
      ],
    );
  } catch (e) {
    console.warn('[blog-review] 외부 이력 저장 실패(무시):', e instanceof Error ? e.message : String(e));
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

  const sourceType: SourceType = body.sourceType === 'external' ? 'external' : 'internal';
  const pool = getChartPgPool();

  const title = String(body.title ?? '').trim();
  const bodyText = String(body.bodyText ?? body.bodyMarkdown ?? '');
  const tags = Array.isArray(body.tags) ? (body.tags as unknown[]).map(String) : [];
  if (!bodyText.trim()) return NextResponse.json({ error: 'bodyText is required' }, { status: 400 });

  // 이미지 수: 명시값 우선, 없으면 본문 [사진:] 표시 개수(위저드 검수 시점엔 이미지 미배정).
  const imageCount = Number.isFinite(Number(body.imageCount))
    ? Math.max(0, Number(body.imageCount))
    : (bodyText.match(/\[사진:/g) ?? []).length;

  let hospitalId: string | null = null;
  let runId = '';
  let groundTruth: string | undefined;
  let keyword: Keyword | null = null;
  let hospitalName = String(body.hospitalName ?? '').trim();
  let hospitalRegion = String(body.hospitalRegion ?? '').trim();

  if (sourceType === 'internal') {
    runId = String(body.runId ?? '').trim();
    if (!isParseRunUuid(runId)) return NextResponse.json({ error: 'runId invalid' }, { status: 400 });
    const runOk = await pool.query<{ hospital_id: string | null }>(
      `SELECT hospital_id FROM chart_pdf.parse_runs WHERE id = $1::uuid`,
      [runId],
    );
    if (runOk.rows.length === 0) return NextResponse.json({ error: 'run not found' }, { status: 404 });
    hospitalId = runOk.rows[0]?.hospital_id ?? null;

    // 근거(GROUND_TRUTH): 위저드가 넘긴 3단계 검수본(아웃라인·인과흐름·케이스개요).
    groundTruth = JSON.stringify({
      caseOverview: body.caseOverview ?? null,
      outline: body.outline ?? null,
      causalFlow: body.causalFlow ?? null,
    }).slice(0, 100_000);

    // 대표키워드: 종 + 주질환명(자동 도출). 위저드 명시값 우선.
    const species = String(body.species ?? '') || findOverview(body.caseOverview, '종');
    const mainDisease = String(body.mainDisease ?? '') || findOverview(body.caseOverview, '주질환');
    keyword = deriveInternalKeyword(species, mainDisease);

    if (!hospitalName || !hospitalRegion) {
      const info = await loadHospitalInfo(pool, hospitalId);
      hospitalName = hospitalName || info.name;
      hospitalRegion = hospitalRegion || info.region;
    }
  } else {
    // 외부: 지정 병원으로 과금(바른플랜 환불). 원본 근거 없음 → keyword 도 LLM 판단.
    hospitalId = String(body.hospitalId ?? '').trim() || null;
  }

  // 사전 점검(잔액 0 이하 차단, 미설정은 통과).
  if (!(await hospitalHasTokens(hospitalId))) {
    return NextResponse.json({ error: '토큰이 부족합니다. 충전 후 다시 시도해 주세요.' }, { status: 402 });
  }

  const operationId = crypto.randomUUID();
  const usageCtx = (feature: string) => ({ hospitalId, feature, runId: runId || undefined, operationId });

  const input: ReviewInput = {
    title,
    bodyText,
    tags,
    imageCount,
    hospitalName: hospitalName || undefined,
    hospitalRegion: hospitalRegion || undefined,
    keyword,
    headingCount: typeof body.headingCount === 'number' ? body.headingCount : undefined,
    groundTruth,
  };

  try {
    const seoMetrics = computeSeoMetrics(input);
    const { aggregate, modelsUsed, reviewers } = await runBlogReviewEnsemble(input, usageCtx);
    const review = assembleReview({ sourceType, aggregate, seoMetrics, modelsUsed, reviewers });

    // 과금: 합산 원가 1회 차감. feature 'blog_review' → product 'case_blog' → 바른플랜 자동 환불.
    await chargeOperationTokens(hospitalId, operationId, 'blog_review');

    if (sourceType === 'internal' && runId) {
      await upsertGeneratedRunContent(pool, runId, 'blog_review', review);
    } else if (sourceType === 'external') {
      await saveExternalReview(pool, {
        sourceUrl: String(body.sourceUrl ?? ''),
        inputText: bodyText,
        hospitalId,
        createdBy: String(body.createdBy ?? '') || null,
        review,
      });
    }

    // 프론트 인라인 하이라이트용으로 검수한 본문·제목도 함께 반환.
    return NextResponse.json({ sourceType, review, modelsUsed, title, bodyText });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('AI_GATEWAY_API_KEY')) {
      return NextResponse.json({ error: 'LLM gateway not configured (AI_GATEWAY_API_KEY)' }, { status: 503 });
    }
    console.error('[blog-review] 실패:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
