import { PDFDocument } from 'pdf-lib';

export async function getPdfPageCount(pdfBuffer: Buffer): Promise<number> {
  const doc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  return doc.getPageCount();
}

/** Inclusive 1-based start/end page indices. */
export async function slicePdfPages(pdfBuffer: Buffer, startPage1: number, endPage1: number): Promise<Buffer> {
  const src = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const n = src.getPageCount();
  const start = Math.max(1, Math.floor(startPage1));
  const end = Math.min(n, Math.floor(endPage1));
  if (start > end || n < 1) {
    throw new Error(`Invalid PDF page range: ${startPage1}-${endPage1} (doc has ${n} pages)`);
  }
  const dest = await PDFDocument.create();
  const zeroBased = Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i);
  const pages = await dest.copyPages(src, zeroBased);
  for (const p of pages) dest.addPage(p);
  return Buffer.from(await dest.save());
}

const MIN_JPEG_BYTES = 10_000;

function extractJpegsFromBinary(buffer: Buffer): Buffer[] {
  const results: Buffer[] = [];
  let i = 0;
  while (i < buffer.length - 3) {
    if (buffer[i] === 0xff && buffer[i + 1] === 0xd8 && buffer[i + 2] === 0xff) {
      const start = i;
      let end = -1;
      for (let j = start + 3; j < buffer.length - 1; j++) {
        if (buffer[j] === 0xff && buffer[j + 1] === 0xd9) {
          end = j + 2;
          break;
        }
      }
      if (end === -1) break;
      if (end - start >= MIN_JPEG_BYTES) {
        results.push(buffer.slice(start, end));
      }
      i = end;
    } else {
      i += 1;
    }
  }
  return results;
}

export async function extractPageJpegsFromImagePdf(
  pdfBuffer: Buffer,
  startPage1: number,
  endPage1: number,
): Promise<Buffer[] | null> {
  const doc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const totalPages = doc.getPageCount();

  const allJpegs = extractJpegsFromBinary(pdfBuffer);

  if (Math.abs(allJpegs.length - totalPages) > 1) return null;

  const start = Math.max(1, Math.floor(startPage1));
  const end = Math.min(totalPages, Math.floor(endPage1));

  return allJpegs.slice(start - 1, end);
}
