import { coverCheckupDateToIsoInputValue } from '@dashboard/health-report';

function yyyyMmddFromInstantKst(instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  if (y && m && d) return `${y}${m}${d}`;
  return '00000000';
}

export function checkupDateYyyyMmdd(coverRaw: string | undefined, runCreatedAtIso: string | undefined): string {
  const iso = coverCheckupDateToIsoInputValue(coverRaw)?.trim() ?? '';
  if (iso) return iso.replace(/-/g, '');
  if (runCreatedAtIso) {
    try {
      return yyyyMmddFromInstantKst(new Date(runCreatedAtIso));
    } catch {
      /* ignore */
    }
  }
  return '00000000';
}

const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f]/g;

export function sanitizePdfFilenameSegment(raw: string, maxLen: number): string {
  let t = raw.replace(ILLEGAL, '_').replace(/\s+/g, ' ').trim();
  t = t.replace(/_+/g, '_').replace(/^\.+|\.+$/g, '');
  if (!t) return '미입력';
  if (t.length > maxLen) t = t.slice(0, maxLen).trimEnd();
  return t;
}

export type HealthCheckupPdfNameInput = {
  hospitalNameKo: string;
  patientName: string;
  programName: string;
  coverCheckupDate: string | undefined;
  runCreatedAtIso: string | undefined;
};

export function buildHealthCheckupPdfBasename(input: HealthCheckupPdfNameInput): string {
  const ymd = checkupDateYyyyMmdd(input.coverCheckupDate, input.runCreatedAtIso);
  const hospital = sanitizePdfFilenameSegment(input.hospitalNameKo, 100);
  const patient = sanitizePdfFilenameSegment(input.patientName, 100);
  return `(${hospital})건강검진리포트_(${patient})_${ymd}.pdf`;
}

export function asciiHealthCheckupReportFallback(friendlyId: string | null | undefined): string {
  const id = (friendlyId ?? 'report').replace(/[^\w.-]/g, '_');
  return `${id}_health_checkup_report.pdf`;
}

export function contentDispositionAttachmentUtf8(utf8Basename: string, asciiFallback: string): string {
  const safeAscii = asciiFallback.replace(/[\r\n"/\\]/g, '_');
  return `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(utf8Basename)}`;
}

/**
 * Read `filename*` (UTF-8) or `filename` from a Content-Disposition header (browser / fetch).
 */
export function parseAttachmentFilenameFromContentDisposition(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const star = /filename\*\s*=\s*(?:UTF-8''|utf-8'')([^;\n]+)/i.exec(headerValue);
  if (star) {
    try {
      let v = star[1].trim();
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      return decodeURIComponent(v);
    } catch {
      /* ignore */
    }
  }
  const quoted = /filename\s*=\s*"((?:\\.|[^"\\])*)"/i.exec(headerValue);
  if (quoted) {
    return quoted[1].replace(/\\(.)/g, '$1');
  }
  const plain = /filename\s*=\s*([^;\n]+)/i.exec(headerValue);
  if (plain) {
    return plain[1].trim().replace(/^"(.*)"$/, '$1');
  }
  return null;
}

