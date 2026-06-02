import type {
  HealthSystemsImageSlot,
  HealthSystemsReportBlock,
} from '@/lib/chart-app/health-systems-demo-blocks';

type HealthSystemsReportRow = { label: string; content: string };

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string';
}

function parseRow(v: unknown): HealthSystemsReportRow | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.label !== 'string' || typeof o.content !== 'string') return null;
  return { label: o.label, content: o.content };
}

function parseDiseaseOptions(
  v: unknown,
): { name: string; body: string; enabled: boolean }[] | null {
  if (!Array.isArray(v)) return null;
  const out: { name: string; body: string; enabled: boolean }[] = [];
  for (const item of v) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const name = typeof o.name === 'string' ? o.name : '';
    if (!name.trim()) continue;
    const body = typeof o.body === 'string' ? o.body : '';
    out.push({ name, body, enabled: o.enabled === true });
  }
  return out.length ? out : null;
}

function parseImageSlot(v: unknown): HealthSystemsImageSlot | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (o.src !== undefined && typeof o.src !== 'string') return null;
  if (o.alt !== undefined && typeof o.alt !== 'string') return null;
  if (o.caption !== undefined && typeof o.caption !== 'string') return null;
  if (o.rotationDeg !== undefined && (typeof o.rotationDeg !== 'number' || !Number.isFinite(o.rotationDeg))) {
    return null;
  }
  return {
    ...(typeof o.src === 'string' ? { src: o.src } : {}),
    ...(typeof o.alt === 'string' ? { alt: o.alt } : {}),
    ...(typeof o.caption === 'string' ? { caption: o.caption } : {}),
    ...(typeof o.rotationDeg === 'number' ? { rotationDeg: o.rotationDeg } : {}),
  };
}

function parseBlock(v: unknown): HealthSystemsReportBlock | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const titleKo = isNonEmptyString(o.titleKo) ? o.titleKo : '';
  const titleEn = isNonEmptyString(o.titleEn) ? o.titleEn : '';

  if (o.variant === 'rows') {
    if (!Array.isArray(o.rows)) return null;
    const rows: HealthSystemsReportRow[] = [];
    for (const r of o.rows) {
      const pr = parseRow(r);
      if (!pr) return null;
      rows.push(pr);
    }
    if (rows.length === 0) return null;
    const compact = o.compact === true;
    const diseaseOptions = parseDiseaseOptions(o.diseaseOptions);
    return {
      variant: 'rows',
      titleKo,
      titleEn,
      rows,
      ...(compact ? { compact: true } : {}),
      ...(diseaseOptions ? { diseaseOptions } : {}),
    };
  }

  if (o.variant === 'diseaseInfo') {
    const name = typeof o.name === 'string' ? o.name : '';
    const body = typeof o.body === 'string' ? o.body : '';
    if (!name.trim() && !body.trim()) return null;
    return { variant: 'diseaseInfo', name, body };
  }

  if (o.variant === 'images') {
    if (!Array.isArray(o.images) || o.images.length !== 3) return null;
    const a = o.images.map(parseImageSlot);
    if (a.some((x) => x === null)) return null;
    return { variant: 'images', titleKo, titleEn, images: [a[0]!, a[1]!, a[2]!] };
  }

  if (o.variant === 'images4') {
    if (!Array.isArray(o.images) || o.images.length !== 4) return null;
    const a = o.images.map(parseImageSlot);
    if (a.some((x) => x === null)) return null;
    return { variant: 'images4', titleKo, titleEn, images: [a[0]!, a[1]!, a[2]!, a[3]!] };
  }

  if (o.variant === 'imagesGrid2x3') {
    if (!Array.isArray(o.images) || o.images.length !== 6) return null;
    const a = o.images.map(parseImageSlot);
    if (a.some((x) => x === null)) return null;
    return { variant: 'imagesGrid2x3', titleKo, titleEn, images: [a[0]!, a[1]!, a[2]!, a[3]!, a[4]!, a[5]!] };
  }

  if (o.variant === 'imagesGrid3x3') {
    if (!Array.isArray(o.images) || o.images.length !== 9) return null;
    const a = o.images.map(parseImageSlot);
    if (a.some((x) => x === null)) return null;
    return {
      variant: 'imagesGrid3x3',
      titleKo,
      titleEn,
      images: [a[0]!, a[1]!, a[2]!, a[3]!, a[4]!, a[5]!, a[6]!, a[7]!, a[8]!],
    };
  }

  return null;
}

export function parseHealthSystemsBlocksFromUnknown(value: unknown): HealthSystemsReportBlock[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out: HealthSystemsReportBlock[] = [];
  for (const item of value) {
    const b = parseBlock(item);
    if (!b) return null;
    out.push(b);
  }
  return out;
}
