'use client';

// 브라우저에서 PDF 를 페이지 래스터화(JPEG 재인코딩)로 압축한다.
// - 30MB(maxBytes) 이하 PDF 는 손대지 않고 원본 반환(작은/벡터 PDF 추출 품질 유지).
// - 초과 시에만 압축 시도(화질 단계적 하향). 실패하면 PdfCompressError 로 던져 호출부가 "압축 실패" 안내.
// - 우리 서버 자원 안 씀(전부 사용자 브라우저). pdfjs 워커는 /pdf.worker.min.mjs (각 앱 public/).
//
// pdfjs 는 SSR 안전을 위해 호출 시점에 동적 import. legacy 빌드(구형 브라우저 호환) + 최소 타입 캐스팅.

import { PDFDocument } from 'pdf-lib';

export class PdfCompressError extends Error {
  constructor(
    public readonly kind: 'too_large' | 'failed',
    message: string,
  ) {
    super(message);
    this.name = 'PdfCompressError';
  }
}

type MinimalViewport = { width: number; height: number };
type MinimalPdfPage = {
  getViewport: (p: { scale: number }) => MinimalViewport;
  render: (p: { canvasContext: CanvasRenderingContext2D; viewport: MinimalViewport }) => { promise: Promise<void> };
  cleanup: () => void;
};
type MinimalPdfDoc = { numPages: number; getPage: (n: number) => Promise<MinimalPdfPage>; destroy: () => Promise<void> };
type MinimalPdfjs = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (p: { data: Uint8Array }) => { promise: Promise<MinimalPdfDoc> };
};

let pdfjsPromise: Promise<MinimalPdfjs> | null = null;
function loadPdfjs(): Promise<MinimalPdfjs> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((mod) => {
      const lib = mod as unknown as MinimalPdfjs;
      lib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      return lib;
    });
  }
  return pdfjsPromise;
}

type Attempt = { targetDpi: number; maxSide: number; quality: number };
// 화질 우선(추출 품질 보존) → 점차 공격적으로. 대부분 1차에서 30MB 밑으로 떨어진다.
const ATTEMPTS: Attempt[] = [
  { targetDpi: 150, maxSide: 2400, quality: 0.72 },
  { targetDpi: 120, maxSide: 2000, quality: 0.6 },
  { targetDpi: 100, maxSide: 1600, quality: 0.5 },
];

/**
 * file.size > maxBytes 면 압축본(File)을, 이하면 원본을 반환.
 * 압축해도 한도 초과면 PdfCompressError('too_large'), 렌더/워커 예외면 PdfCompressError('failed').
 */
export async function compressPdfIfNeeded(file: File, maxBytes: number): Promise<File> {
  if (file.size <= maxBytes) return file;

  let pdfjs: MinimalPdfjs;
  let srcBytes: Uint8Array;
  try {
    pdfjs = await loadPdfjs();
    srcBytes = new Uint8Array(await file.arrayBuffer());
  } catch (e) {
    throw new PdfCompressError('failed', `압축 준비 실패: ${e instanceof Error ? e.message : String(e)}`);
  }

  let lastSize = file.size;
  for (const attempt of ATTEMPTS) {
    let out: Uint8Array;
    try {
      out = await rasterizePdf(pdfjs, srcBytes, attempt);
    } catch (e) {
      throw new PdfCompressError('failed', `압축 중 오류: ${e instanceof Error ? e.message : String(e)}`);
    }
    lastSize = out.byteLength;
    if (out.byteLength <= maxBytes) {
      return new File([new Uint8Array(out)], file.name, { type: 'application/pdf', lastModified: file.lastModified });
    }
  }
  throw new PdfCompressError('too_large', `압축 후에도 용량이 큽니다(${(lastSize / 1048576).toFixed(1)}MB).`);
}

async function rasterizePdf(pdfjs: MinimalPdfjs, srcBytes: Uint8Array, attempt: Attempt): Promise<Uint8Array> {
  // getDocument 는 입력 버퍼를 detach 할 수 있어 시도마다 복사본 전달.
  const doc = await pdfjs.getDocument({ data: srcBytes.slice() }).promise;
  try {
    const outPdf = await PDFDocument.create();
    for (let p = 1; p <= doc.numPages; p += 1) {
      const page = await doc.getPage(p);
      try {
        const base = page.getViewport({ scale: 1 });
        const longest = Math.max(base.width, base.height) || 1;
        const dpiScale = attempt.targetDpi / 72;
        const scale = longest * dpiScale > attempt.maxSide ? attempt.maxSide / longest : dpiScale;
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.ceil(viewport.width));
        canvas.height = Math.max(1, Math.ceil(viewport.height));
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas 2d context 없음');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;

        const jpeg = await canvasToJpegBytes(canvas, attempt.quality);
        const img = await outPdf.embedJpg(jpeg);
        const pageOut = outPdf.addPage([canvas.width, canvas.height]);
        pageOut.drawImage(img, { x: 0, y: 0, width: canvas.width, height: canvas.height });

        canvas.width = 0; // 캔버스 메모리 해제
        canvas.height = 0;
      } finally {
        page.cleanup();
      }
    }
    return await outPdf.save();
  } finally {
    await doc.destroy();
  }
}

function canvasToJpegBytes(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('canvas.toBlob 가 null'));
          return;
        }
        blob.arrayBuffer().then((ab) => resolve(new Uint8Array(ab))).catch(reject);
      },
      'image/jpeg',
      quality,
    );
  });
}
