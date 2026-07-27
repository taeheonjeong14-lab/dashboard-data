import sharp from 'sharp';
import { decodeBmpToRaw, isBmp } from './bmp';

/**
 * sharp 입력 형태. sharp 가 못 읽는 형식(BMP)은 미리 raw 픽셀로 풀어서,
 * 그 뒤 리사이즈·webp 인코딩은 다른 형식과 완전히 같은 경로를 타게 한다.
 */
type SharpSource = { input: Buffer; options?: Parameters<typeof sharp>[1] };

function toSharpSource(input: Buffer): SharpSource {
  if (!isBmp(input)) return { input };
  const { data, width, height, channels } = decodeBmpToRaw(input);
  return { input: data, options: { raw: { width, height, channels } } };
}

export type PreparedImagePayload = {
  buffer: Buffer;
  mimeType: 'image/webp';
  byteSize: number;
};

function parseEnvInt(name: string, fallback: number): number {
  const v = process.env[name]?.trim();
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function encodeOnce(src: SharpSource, maxEdge: number, quality: number): Promise<Buffer> {
  let pipeline = sharp(src.input, src.options).rotate();
  const meta = await pipeline.metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w > 0 && h > 0 && (w > maxEdge || h > maxEdge)) {
    pipeline = pipeline.resize({
      width: w >= h ? maxEdge : undefined,
      height: h > w ? maxEdge : undefined,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }
  return pipeline.webp({ quality, effort: 4 }).toBuffer();
}

// 최대 512KB로 압축 (vet-report 동일 기준)
const STORED_MAX_BYTES = 512 * 1024;

export async function prepareImageForAnalysis(input: Buffer): Promise<PreparedImagePayload> {
  const baseEdge = parseEnvInt('IMAGE_CASE_MAX_EDGE', 2048);
  const baseQ = parseEnvInt('IMAGE_CASE_WEBP_QUALITY', 82);
  const steps: Array<{ maxEdge: number; quality: number }> = [
    { maxEdge: baseEdge, quality: baseQ },
    { maxEdge: baseEdge, quality: 72 },
    { maxEdge: Math.min(baseEdge, 1920), quality: 72 },
    { maxEdge: 1600, quality: 65 },
    { maxEdge: 1600, quality: 55 },
    { maxEdge: 1280, quality: 55 },
    { maxEdge: 1280, quality: 48 },
    { maxEdge: 1024, quality: 48 },
    { maxEdge: 1024, quality: 42 },
  ];
  // 디코딩 실패(지원하지 않는 BMP 변형 등)는 압축 재시도로 해결되지 않으므로 여기서 바로 던진다.
  const src = toSharpSource(input);
  let lastError: unknown;
  for (const step of steps) {
    try {
      const buf = await encodeOnce(src, step.maxEdge, step.quality);
      if (buf.length <= STORED_MAX_BYTES) {
        return { buffer: buf, mimeType: 'image/webp', byteSize: buf.length };
      }
    } catch (e) {
      lastError = e;
    }
  }
  const hint = lastError instanceof Error ? lastError.message : '';
  throw new Error(
    `이미지 압축 후에도 ${Math.floor(STORED_MAX_BYTES / 1024)}KB 이하로 맞출 수 없습니다. 더 작은 파일을 올려 주세요.${hint ? ` (${hint})` : ''}`,
  );
}
