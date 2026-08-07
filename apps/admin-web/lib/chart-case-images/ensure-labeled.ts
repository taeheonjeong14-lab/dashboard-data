/**
 * 케이스 이미지 라벨링을 **필요한 시점에 1회만** 수행한다.
 *
 * 예전에는 업로드·임포트할 때마다 라벨링을 돌렸다. 그런데 추출 단계에서는 라벨을 아무도 안 본다.
 *  - 사진을 나눠 올리면 그때마다 **기존 이미지까지 통째로 다시** 분석했다(3장+2장 → 3+5=8장)
 *  - 병원 제출분 임포트는 진료 날짜 그룹 수만큼 호출됐다(4일치면 한 번에 4회)
 *  - 추출만 하고 끝나는 run 도 쓰지도 않을 라벨을 만들었다
 *
 * 규칙은 하나다: **이미지를 처음 실제로 쓰는 쪽이 라벨링한다.** 지금 그 지점은 둘이다 —
 * 건강검진 리포트 생성(배치·정렬·캡션에 라벨이 필요)과 진료케이스 블로그의 이미지 배정 단계
 * (썸네일 캡션·다운로드 파일명이 bodyPart 에서 나온다). 먼저 도달한 쪽이 채우고, 나중 쪽은 그냥 지나간다.
 *
 * 미분류 표시는 `exam_type IS NULL` 이다(컬럼이 nullable 이라 마이그레이션이 필요 없다).
 * 과금 product 는 **호출한 쪽이 정한다** — 업로드 화면 맥락으로 추측하던 예전 방식과 달리,
 * 지금은 "무슨 작업을 하다가 라벨이 필요해졌나"가 곧 답이라 추측할 여지가 없다.
 */
import crypto from 'node:crypto';
import { getAdminWebPgPool } from '@/lib/db';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { chargeOperationTokens } from '@/lib/billing/token-charge';
import { analyzeImageGroup, type ImageInputPart } from '@/lib/chart-case-images/analyze';

const CASE_IMAGES_BUCKET = 'chart-case-images';

type UnlabeledRow = {
  id: string;
  file_name: string;
  storage_path: string;
  exam_date: string | null;
};

function mimeOf(storagePath: string): ImageInputPart['mimeType'] {
  const ext = storagePath.split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}

export type EnsureLabeledResult = {
  /** 이번에 라벨을 채운 이미지 수. 0 이면 아무것도 하지 않았다(= LLM 호출 없음). */
  labeled: number;
  /** 날짜 그룹 수 = 실제 LLM 호출 횟수. */
  groups: number;
};

/**
 * run 의 미분류 이미지를 라벨링한다. 전부 분류돼 있으면 즉시 반환(LLM 호출 0).
 * 실패는 던지지 않는다 — 라벨이 없으면 배치가 라벨 없이 진행될 뿐, 생성 자체를 막을 이유는 없다.
 * (실패 사실은 호출부가 에러 로그로 올린다.)
 */
/**
 * 촬영일이 비어 있는 이미지에 **이 run 의 검사일**을 채운다.
 *
 * 병원이 사진을 날짜 그룹 없이 올리면 exam_date 가 null 로 들어온다. 그런데 건강검진 리포트는
 * 검진일과 날짜가 같은 이미지만 근거로 쓰기 때문에, 날짜가 없으면 아무리 분석해도 리포트에
 * 실리지 않는다. run 의 검사일이 하나로 정해질 때만 채운다 — 여러 날짜가 섞인 차트에서 전부
 * 한 날짜로 몰아 버리면 그게 더 나쁘다.
 */
async function backfillMissingExamDates(
  pool: ReturnType<typeof getAdminWebPgPool>,
  runId: string,
): Promise<string | null> {
  // 1순위: 외부 랩 결과지의 검체채취일(추출 때 읽어 둔 값).
  const { rows: runRows } = await pool.query<{ collection_date: string | null }>(
    `SELECT raw_payload->'externalLabReport'->'header'->>'collectionDate' AS collection_date
       FROM chart_pdf.parse_runs WHERE id = $1::uuid`,
    [runId],
  );
  let date = runRows[0]?.collection_date?.trim() || null;

  // 2순위: 검사 결과의 날짜가 하나뿐이면 그 날짜.
  if (!date) {
    const { rows: labRows } = await pool.query<{ d: string | null }>(
      `SELECT DISTINCT (date_time::date)::text AS d
         FROM chart_pdf.result_lab_items
        WHERE parse_run_id = $1::uuid AND date_time ~ '^\\d{4}-\\d{2}-\\d{2}'`,
      [runId],
    );
    if (labRows.length === 1) date = labRows[0]?.d ?? null;
  }
  if (!date) return null;

  const res = await pool.query(
    `UPDATE chart_pdf.parse_run_case_images SET exam_date = $2::date
      WHERE parse_run_id = $1::uuid AND exam_date IS NULL`,
    [runId, date],
  );
  if (res.rowCount) console.info(`[ensure-labeled] 촬영일 없는 이미지 ${res.rowCount}장에 ${date} 부여 · run ${runId}`);
  return date;
}

export async function ensureRunImagesLabeled(
  runId: string,
  /** 토큰 차감 귀속. 건강검진은 유료, 진료케이스는 바른플랜이면 즉시 환불(net 0). */
  product: 'health_report' | 'case_blog',
): Promise<EnsureLabeledResult> {
  const pool = getAdminWebPgPool();

  // 라벨링은 날짜 그룹 단위이고 요약도 그 날짜로 저장되므로, 날짜부터 채우고 시작한다.
  await backfillMissingExamDates(pool, runId).catch((e) => {
    console.error('[ensure-labeled] 촬영일 backfill 실패(라벨링은 계속):', e);
    return null;
  });

  const { rows } = await pool.query<UnlabeledRow>(
    `SELECT id, file_name, storage_path, exam_date
       FROM chart_pdf.parse_run_case_images
      WHERE parse_run_id = $1::uuid AND exam_type IS NULL
      ORDER BY idx ASC`,
    [runId],
  );
  if (rows.length === 0) return { labeled: 0, groups: 0 };

  const { rows: hr } = await pool.query<{ hospital_id: string | null }>(
    `SELECT hospital_id FROM chart_pdf.parse_runs WHERE id = $1::uuid`,
    [runId],
  );
  const hospitalId = hr[0]?.hospital_id ?? null;

  const supabase = createServiceRoleClient();

  // 날짜별로 묶어 분석한다 — 시사점이 "그 날짜의 검사 묶음" 단위라 원래 그렇게 저장한다.
  const byDate = new Map<string | null, UnlabeledRow[]>();
  for (const r of rows) {
    const k = r.exam_date ?? null;
    const cur = byDate.get(k);
    if (cur) cur.push(r);
    else byDate.set(k, [r]);
  }

  const operationId = crypto.randomUUID();
  let labeled = 0;
  let groups = 0;

  for (const [examDate, groupRows] of byDate) {
    // 열지 못하는 파일 한 장이 그룹 전체를 죽이지 않도록 장별로 격리한다.
    const parts: (ImageInputPart & { id: string })[] = [];
    for (const r of groupRows) {
      try {
        const { data: blob, error } = await supabase.storage.from(CASE_IMAGES_BUCKET).download(r.storage_path);
        if (error || !blob) continue;
        const buffer = Buffer.from(await blob.arrayBuffer());
        parts.push({ id: r.id, buffer, fileName: r.file_name, mimeType: mimeOf(r.storage_path) });
      } catch {
        /* 한 장 실패는 건너뛴다 */
      }
    }
    if (parts.length === 0) continue;

    groups += 1;
    const analysis = await analyzeImageGroup({
      examDate: examDate ?? '',
      images: parts.map(({ buffer, fileName, mimeType }) => ({ buffer, fileName, mimeType })),
      usageContext: { hospitalId, runId, feature: 'image_analysis', operationId },
    });

    for (let i = 0; i < parts.length; i++) {
      const result = analysis.images[i];
      await pool.query(
        `UPDATE chart_pdf.parse_run_case_images
            SET exam_type = $2, radiology_sub = $3, body_part = $4
          WHERE id = $1::uuid`,
        [parts[i].id, result?.examType ?? 'other', result?.radiologySub ?? null, result?.bodyPart ?? ''],
      );
      labeled += 1;
    }

    await pool.query(
      `DELETE FROM chart_pdf.parse_run_case_image_summaries
        WHERE parse_run_id = $1::uuid AND exam_date IS NOT DISTINCT FROM $2`,
      [runId, examDate],
    );
    if (analysis.bullets.length > 0) {
      await pool.query(
        `INSERT INTO chart_pdf.parse_run_case_image_summaries (parse_run_id, exam_date, bullets)
         VALUES ($1::uuid, $2, $3::jsonb)`,
        [runId, examDate, JSON.stringify(analysis.bullets)],
      );
    }
  }

  // 호출이 몇 번이었든 작업 단위로 1회만 차감한다(usage 는 operationId 로 묶여 있다).
  if (groups > 0) {
    await chargeOperationTokens(hospitalId, operationId, 'image_analysis', product);
  }
  return { labeled, groups };
}
