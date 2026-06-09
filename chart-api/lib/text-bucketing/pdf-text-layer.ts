import pdfParse from 'pdf-parse';
import type { OrderedLine } from '@/lib/text-bucketing/ocr-line-correction';

export type TextLayerResult = {
  lines: OrderedLine[];
  numPages: number;
  /** 페이지별 텍스트 레이어 글자 수 (품질 게이트용) */
  charsByPage: Map<number, number>;
};

/**
 * PDF 임베디드 텍스트 레이어를 페이지별 "시각 줄" 순서로 추출한다.
 * Gemini 이미지 전사와 달리 (1) 반복 블록을 스킵하지 않고 (2) 순서를 보존한다.
 * 디지털 EMR 출력처럼 텍스트 레이어가 충실한 PDF에 한해 1순위 추출 경로로 쓴다(품질 게이트로 판단).
 *
 * 줄 재구성: pdf.js textContent 아이템을 동일 y(transform[5]) 기준으로 묶는다.
 * (pdf-parse 기본 render_page 와 동일 — 본 PDF에서 시각순 정확도 검증됨)
 */
export async function extractOrderedLinesFromTextLayer(pdfBuffer: Buffer): Promise<TextLayerResult> {
  const lines: OrderedLine[] = [];
  const charsByPage = new Map<number, number>();
  let pageCounter = 0;

  // pdf-parse 는 페이지를 1..N 순차로 처리하며 각 페이지마다 pagerender 를 await 한다.
  // page 번호는 pdf.js PDFPageProxy.pageNumber(1-based)를 우선 쓰고, 없으면 순차 카운터로 보강.
  const pagerender = (pageData: {
    pageNumber?: number;
    getTextContent: (opts: { normalizeWhitespace: boolean; disableCombineTextItems: boolean }) => Promise<{
      items: Array<{ str: string; transform: number[] }>;
    }>;
  }): Promise<string> => {
    pageCounter += 1;
    const page = typeof pageData.pageNumber === 'number' ? pageData.pageNumber : pageCounter;
    return pageData
      .getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false })
      .then((tc) => {
        let lastY: number | undefined;
        let buf = '';
        let chars = 0;
        const flush = () => {
          const text = buf.replace(/[ \t ]+$/u, '');
          if (text.trim().length > 0) lines.push({ page, text });
          buf = '';
        };
        for (const item of tc.items) {
          const y = item.transform?.[5];
          if (lastY === undefined || y === lastY) {
            buf += item.str;
          } else {
            flush();
            buf += item.str;
          }
          lastY = y;
          chars += (item.str ?? '').length;
        }
        flush();
        charsByPage.set(page, chars);
        return ''; // pdf-parse 의 합본 text 는 쓰지 않음(우리는 lines 로 받는다)
      });
  };

  const data = await pdfParse(pdfBuffer, { pagerender } as unknown as Parameters<typeof pdfParse>[1]);
  return { lines, numPages: data.numpages, charsByPage };
}

/**
 * 텍스트 레이어가 "충실"한지(=1순위 경로로 쓸 만한지) 판정.
 * 스캔 PDF는 텍스트 레이어가 거의 비어 있어 false → 기존 Gemini+OCR 경로로 폴백.
 */
export function isTextLayerSufficient(result: TextLayerResult): boolean {
  if (result.numPages <= 0 || result.lines.length < 10) return false;
  const pagesWithText = [...result.charsByPage.values()].filter((c) => c >= 50).length;
  return pagesWithText / result.numPages >= 0.5;
}
