import { randomUUID } from 'crypto';

const PREFIX = 'extract-uploads';

function yyyyMmDd(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Strip traversal / weird chars; keep extension .pdf when sane. */
export function sanitizePdfFileName(fileName: string): string {
  const base =
    fileName
      .replace(/^[\\/]+/g, '')
      .replace(/\.\./g, '')
      .split(/[/\\]/)
      .pop()
      ?.trim() || 'upload.pdf';
  let safe = base.replace(/[^\w.\-]+/g, '_').slice(0, 200);
  if (!safe.toLowerCase().endsWith('.pdf')) {
    safe = `${safe}.pdf`;
  }
  return safe || 'upload.pdf';
}

/**
 * vet-report / 파트너 문서 규약: extract-uploads/YYYY-MM-DD/{uuid}-{sanitized}.pdf
 */
export function buildPdfExtractStoragePath(fileName: string): string {
  const id = randomUUID();
  const name = sanitizePdfFileName(fileName);
  return `${PREFIX}/${yyyyMmDd()}/${id}-${name}`;
}

export function isAllowedPdfExtractPath(path: string): boolean {
  const p = path.trim();
  return p.startsWith(`${PREFIX}/`) && !p.includes('..');
}

/** PDF·이미지 공통 업로드 파일명 정리 — 실제 확장자(pdf/jpg/jpeg/png/webp)를 보존한다. */
export function sanitizeUploadFileName(fileName: string): string {
  const base =
    fileName
      .replace(/^[\\/]+/g, '')
      .replace(/\.\./g, '')
      .split(/[/\\]/)
      .pop()
      ?.trim() || 'upload';
  return base.replace(/[^\w.\-]+/g, '_').slice(0, 200) || 'upload';
}

/** 추가 자료(외부 검사 결과서 등) 업로드 경로 — PDF·이미지 공통, 확장자 보존. */
export function buildExtractUploadStoragePath(fileName: string): string {
  const id = randomUUID();
  const name = sanitizeUploadFileName(fileName);
  return `${PREFIX}/${yyyyMmDd()}/${id}-${name}`;
}
