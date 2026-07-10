'use client';

// 업로드 전에 브라우저에서 PDF 페이지 수를 센다.
// chart-api(text-bucketing)가 40페이지 초과를 413 으로 거부하는데, 그때는 이미 파일을 Storage 에
// 올린 뒤라 사용자가 한참 기다린 끝에야 실패를 본다. 제출 전에 미리 잡는다.
//
// 주의: chart-api 는 여러 PDF 를 mergePdfs() 로 합친 뒤 페이지를 센다.
// 따라서 파일별이 아니라 "합계"로 비교해야 서버 판정과 일치한다.

import { PDFDocument } from 'pdf-lib';

/** chart-api 의 TEXT_BUCKETING_MAX_PAGES 기본값과 같아야 한다. */
const DEFAULT_MAX_PDF_PAGES = 50;

/**
 * env 오타로 검사가 뒤집히지 않게 막는다.
 * `Number('-5') || 50` 은 -5 가 truthy 라 그대로 통과해, 1페이지 PDF 까지 전부 차단해 버린다.
 * 정수 1 이상만 받고 나머지는 기본값으로 떨어진다.
 */
function parsePageLimit(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_PDF_PAGES;
  return Math.floor(n);
}

/**
 * chart-api 의 TEXT_BUCKETING_MAX_PAGES 와 반드시 같은 값이어야 한다.
 *
 * 한쪽만 올리면 이렇게 어긋난다:
 * - 클라이언트가 더 엄격하면 → 서버는 받는데 업로드가 막히고, 안내 문구도 틀린 숫자를 말한다.
 * - 클라이언트가 더 관대하면 → 업로드를 다 마친 뒤 서버가 413 으로 거부한다(고치기 전의 그 경험).
 *
 * NEXT_PUBLIC_* 는 빌드 시점에 값이 박히므로, 값을 바꾸면 hospital-web 재배포가 필요하다.
 * chart-api 도 마찬가지로 재배포해야 새 env 가 적용된다. 둘을 같이 올릴 것.
 *
 * DEFAULT_MAX_PDF_PAGES 선언보다 반드시 뒤에 와야 한다 — const 는 호이스팅되지 않아
 * 앞에 두면 env 미설정 시 모듈 로드가 ReferenceError 로 죽는다(env 가 있으면 안 터져서 더 위험).
 */
export const MAX_PDF_PAGES = parsePageLimit(process.env.NEXT_PUBLIC_PDF_MAX_PAGES);

/** 페이지 수를 셀 수 없으면 null. 막지 않고 서버 판정에 맡기기 위함. */
async function countPages(file: File): Promise<number | null> {
  try {
    const bytes = await file.arrayBuffer();
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    return doc.getPageCount();
  } catch {
    return null;
  }
}

export type PdfPageCheck =
  | { ok: true; total: number | null }
  | { ok: false; total: number; message: string };

/**
 * 선택된 PDF 전체의 페이지 합계를 검사한다.
 * 한 파일이라도 셀 수 없으면 검사를 포기하고 통과시킨다(서버가 최종 판정).
 */
export async function checkPdfPageLimit(files: File[]): Promise<PdfPageCheck> {
  if (files.length === 0) return { ok: true, total: null };

  const counts = await Promise.all(files.map(countPages));
  if (counts.some((c) => c === null)) return { ok: true, total: null };

  const total = (counts as number[]).reduce((a, b) => a + b, 0);
  if (total <= MAX_PDF_PAGES) return { ok: true, total };

  const perFile =
    files.length > 1
      ? ` (${files.map((f, i) => `${f.name} ${counts[i]}p`).join(', ')} 합계)`
      : '';
  return {
    ok: false,
    total,
    message: `PDF가 너무 깁니다 (${total}페이지)${perFile}. 한 번에 ${MAX_PDF_PAGES}페이지까지만 분석할 수 있어요. 해당 진료분 페이지만 잘라서 올려주세요.`,
  };
}
