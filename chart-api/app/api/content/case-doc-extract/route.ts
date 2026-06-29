import { NextRequest, NextResponse } from 'next/server';
import { chartAppAuthMiddleware } from '@/lib/chart-app/auth';
import { extractPdfText } from '@/lib/chart-app/extract-pdf-text';
import { downloadStorageObject } from '@/lib/chart-app/storage-object';
import { geminiGenerateFromParts } from '@/lib/chart-app/gemini';
import { getPdfUploadsBucket } from '@/lib/chart-app/storage-config';
import { isAllowedPdfExtractPath } from '@/lib/chart-app/upload-path';

// POST /api/content/case-doc-extract — 진료케이스 "추가 자료"(외부 검사 결과서 등) 텍스트 추출.
// 입력 JSON: { storagePath, bucket?, mimeType?, fileName? }. 출력: { fileName, text }.
// PDF(텍스트층) → 텍스트 추출 / PDF(스캔본)·이미지 → Gemini 비전 OCR.
// 별도 토큰 차감 없음 — 호출하는 case_blog 추출 과금에 포함된다.
export const maxDuration = 120;
export const runtime = 'nodejs';

const MAX_TEXT = 100_000;
const OCR_PROMPT =
  '이 문서(외부 검사 결과서 등)에 보이는 모든 텍스트를 원문 그대로, 위에서 아래 순서대로 빠짐없이 추출해 한 덩어리 문자열로만 답하세요. 표는 행 단위로 줄을 나눠 적되 내용은 그대로 두세요. 설명·요약·머리말 없이 추출한 텍스트만 출력합니다. 글자가 전혀 없으면 빈 문자열로 답하세요.';

function isPdfMime(m: string): boolean {
  const x = m.toLowerCase();
  return x === 'application/pdf' || x === 'application/x-pdf';
}

export async function POST(request: NextRequest) {
  const authErr = chartAppAuthMiddleware(request);
  if (authErr) return authErr;

  let body: { storagePath?: string; bucket?: string; mimeType?: string; fileName?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON', fileName: '', text: '' }, { status: 400 });
  }

  const storagePath = String(body.storagePath ?? '').trim();
  const mimeType = String(body.mimeType ?? '').trim().toLowerCase();
  const fileName = String(body.fileName ?? '').trim() || storagePath.split('/').pop() || 'document';
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
        // 스캔본 PDF(텍스트층 없음) → 비전 OCR
        text = (
          await geminiGenerateFromParts([
            { text: OCR_PROMPT },
            { inlineData: { mimeType: 'application/pdf', data: buf.toString('base64') } },
          ])
        ).trim();
      }
    } else {
      // 이미지(JPG/PNG 등) → 비전 OCR
      const mt = mimeType || 'image/jpeg';
      text = (
        await geminiGenerateFromParts([
          { text: OCR_PROMPT },
          { inlineData: { mimeType: mt, data: buf.toString('base64') } },
        ])
      ).trim();
    }

    if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT);
    return NextResponse.json({ fileName, text });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg.includes('GEMINI_API_KEY') ? 503 : msg.toLowerCase().includes('not found') ? 404 : 500;
    return NextResponse.json({ error: msg, fileName, text: '' }, { status });
  }
}
