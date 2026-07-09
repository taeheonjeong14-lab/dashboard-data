import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { chartAppAuthMiddleware } from '@/lib/chart-app/auth';
import { extractPdfText } from '@/lib/chart-app/extract-pdf-text';
import { downloadStorageObject } from '@/lib/chart-app/storage-object';
import { geminiGenerateFromParts } from '@/lib/chart-app/gemini';
import { getPdfUploadsBucket } from '@/lib/chart-app/storage-config';
import { isAllowedPdfExtractPath } from '@/lib/chart-app/upload-path';
import { chargeOperationTokens } from '@/lib/billing/token-charge';

// POST /api/content/case-doc-extract — 진료케이스 "추가 자료"(외부 검사 결과서 등) 텍스트 추출.
// 입력 JSON: { storagePath, bucket?, mimeType?, fileName?, hospitalId?, runId? }. 출력: { fileName, text }.
// PDF(텍스트층) → 텍스트 추출(비용 없음) / PDF(스캔본)·이미지 → Gemini 비전 OCR(비용 발생).
// 과금: 비전 OCR 사용량을 케이스 run(runId)에 귀속해 적재 → operation 단위로 토큰 차감(product=case_blog).
//       그러면 usage 집계에서 그 케이스와 같은 run 으로 묶여 표시된다.
export const maxDuration = 120;
export const runtime = 'nodejs';

const MAX_TEXT = 100_000;
const OCR_PROMPT =
  '이 문서(외부 검사 결과서 등)에 보이는 모든 텍스트를 원문 그대로, 위에서 아래 순서대로 빠짐없이 추출해 한 덩어리 문자열로만 답하세요. 표는 행 단위로 줄을 나눠 적되 내용은 그대로 두세요. 설명·요약·머리말 없이 추출한 텍스트만 출력합니다. 글자가 전혀 없으면 빈 문자열로 답하세요.';
// 파일별 임상 요약 — 진료케이스 생성 입력에 넣을 수 있도록, 검사 결과의 핵심 데이터만 압축한다.
const SUMMARY_PROMPT =
  '아래는 동물병원 진료케이스의 참고용 외부 자료(외부 검사 결과서 등)에서 추출한 원문 텍스트입니다. 진료케이스 글 작성에 쓸 수 있도록 핵심만 간결히 요약하세요. 규칙: (1) 검사명·수치·단위·정상범위·비정상 소견·판독 결론·검사일 등 임상적으로 의미 있는 데이터만 남긴다. (2) 병원명·환자 인적사항·페이지번호·서식 문구 등 불필요한 내용은 제외. (3) 원문에 있는 것만, 없는 내용 창작 금지. (4) 한국어, 항목별 짧은 줄. 요약 텍스트만 출력(머리말·설명 없이). 의미 있는 내용이 없으면 빈 문자열로 답하세요.';
const MAX_SUMMARY = 4_000;

function isPdfMime(m: string): boolean {
  const x = m.toLowerCase();
  return x === 'application/pdf' || x === 'application/x-pdf';
}

export async function POST(request: NextRequest) {
  const authErr = chartAppAuthMiddleware(request);
  if (authErr) return authErr;

  let body: { storagePath?: string; bucket?: string; mimeType?: string; fileName?: string; hospitalId?: string; runId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON', fileName: '', text: '' }, { status: 400 });
  }

  const storagePath = String(body.storagePath ?? '').trim();
  const mimeType = String(body.mimeType ?? '').trim().toLowerCase();
  const fileName = String(body.fileName ?? '').trim() || storagePath.split('/').pop() || 'document';
  const hospitalId = String(body.hospitalId ?? '').trim() || null;
  const runId = String(body.runId ?? '').trim() || null;
  // 비전 OCR 사용량을 케이스 run 에 귀속하기 위한 operation id.
  const operationId = randomUUID();
  const usageContext = { hospitalId, runId, operationId, feature: 'case_doc' };
  if (!storagePath) {
    return NextResponse.json({ error: 'storagePath required', fileName, text: '' }, { status: 400 });
  }
  if (!isAllowedPdfExtractPath(storagePath)) {
    return NextResponse.json({ error: 'storagePath must use extract-uploads/ prefix', fileName, text: '' }, { status: 400 });
  }
  const bucket = typeof body.bucket === 'string' && body.bucket.trim() ? body.bucket.trim() : getPdfUploadsBucket();

  try {
    const buf = await downloadStorageObject({ bucket, path: storagePath });
    const looksPdf = isPdfMime(mimeType) || (!mimeType && storagePath.toLowerCase().endsWith('.pdf'));

    let text = '';
    if (looksPdf) {
      const ex = await extractPdfText(buf);
      text = (ex.text || '').trim();
      if (!text) {
        // 스캔본 PDF(텍스트층 없음) → 비전 OCR (사용량을 케이스 run 에 귀속)
        text = (
          await geminiGenerateFromParts(
            [
              { text: OCR_PROMPT },
              { inlineData: { mimeType: 'application/pdf', data: buf.toString('base64') } },
            ],
            usageContext,
          )
        ).trim();
      }
    } else {
      // 이미지(JPG/PNG 등) → 비전 OCR (사용량을 케이스 run 에 귀속)
      const mt = mimeType || 'image/jpeg';
      text = (
        await geminiGenerateFromParts(
          [
            { text: OCR_PROMPT },
            { inlineData: { mimeType: mt, data: buf.toString('base64') } },
          ],
          usageContext,
        )
      ).trim();
    }

    if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT);

    // 파일별 임상 요약(1회). 같은 operationId 로 usage 를 귀속시켜 아래 차감에 합산된다.
    // 원문은 admin 열람·보관용, 요약은 진료케이스 생성 입력용.
    let summary = '';
    if (text) {
      try {
        summary = (
          await geminiGenerateFromParts([{ text: `${SUMMARY_PROMPT}\n\n---\n${text}` }], usageContext)
        ).trim();
        if (summary.length > MAX_SUMMARY) summary = summary.slice(0, MAX_SUMMARY);
      } catch {
        /* 요약 실패는 비차단 — 원문만으로 진행 */
      }
    }

    // 비전 OCR·요약 사용량을 토큰으로 차감(케이스 run 에 귀속, product=case_blog).
    // 텍스트층 PDF 처럼 LLM 미사용이면 적재된 usage 가 없어 차감액 0 → 무시된다(멱등).
    try {
      await chargeOperationTokens(hospitalId, operationId, 'case_doc', 'case_blog');
    } catch {
      /* 과금 실패는 본 추출을 막지 않는다 */
    }

    return NextResponse.json({ fileName, text, summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg.includes('GEMINI_API_KEY') ? 503 : msg.toLowerCase().includes('not found') ? 404 : 500;
    return NextResponse.json({ error: msg, fileName, text: '' }, { status });
  }
}
