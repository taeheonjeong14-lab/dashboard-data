/**
 * BMP 디코더 (최소 구현).
 *
 * sharp(libvips)는 BMP 디코더를 포함하지 않는다. 그런데 일부 병원 차트·영상 장비가
 * 캡처를 BMP 로 내보내서, 그대로 두면 압축 단계에서 "unsupported image format" 으로 죽는다.
 * BMP 는 무압축 래스터라 헤더만 읽으면 픽셀을 그대로 꺼낼 수 있으므로, 여기서 raw RGB 로
 * 풀어 sharp 에 넘긴다(디코딩 비용은 압축 해제가 없어 무시할 수준).
 *
 * 지원: BI_RGB 무압축의 8bpp(팔레트) · 24bpp · 32bpp, top-down/bottom-up 양쪽.
 * 미지원(1·4bpp, RLE, 16bpp 등)은 명확한 메시지로 던진다 — 호출부가 그 장만 건너뛴다.
 */

export type DecodedRaw = {
  data: Buffer;
  width: number;
  height: number;
  /** 항상 RGB 3채널로 풀어 준다. */
  channels: 3;
};

const BI_RGB = 0;
const BI_BITFIELDS = 3;

/** 파일 시그니처로 BMP 인지 판별. 매직 넘버가 'BM' 인 것만 BMP 로 본다. */
export function isBmp(buf: Buffer): boolean {
  return buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d;
}

export function decodeBmpToRaw(buf: Buffer): DecodedRaw {
  if (!isBmp(buf)) throw new Error('BMP 파일이 아닙니다.');
  if (buf.length < 54) throw new Error('BMP 헤더가 잘렸습니다.');

  const pixelOffset = buf.readUInt32LE(10);
  const dibSize = buf.readUInt32LE(14);
  // BITMAPCOREHEADER(12) 는 필드 배치가 달라 지원하지 않는다. 40 이상(INFO/V4/V5)만 처리.
  if (dibSize < 40) throw new Error(`지원하지 않는 BMP 헤더입니다(DIB ${dibSize}).`);

  const width = buf.readInt32LE(18);
  const rawHeight = buf.readInt32LE(22);
  const bpp = buf.readUInt16LE(28);
  const compression = buf.readUInt32LE(30);
  // height 가 음수면 top-down(첫 줄이 이미지 맨 위). 양수면 bottom-up(BMP 기본).
  const topDown = rawHeight < 0;
  const height = Math.abs(rawHeight);

  if (width <= 0 || height <= 0) throw new Error('BMP 크기가 올바르지 않습니다.');
  if (compression !== BI_RGB && !(compression === BI_BITFIELDS && bpp === 32)) {
    throw new Error(`지원하지 않는 BMP 압축 방식입니다(compression=${compression}).`);
  }
  if (bpp !== 8 && bpp !== 24 && bpp !== 32) {
    throw new Error(`지원하지 않는 BMP 색 심도입니다(${bpp}bpp).`);
  }

  // 팔레트(8bpp 이하에만 존재). biClrUsed 가 0 이면 2^bpp 개가 기본.
  let palette: Buffer | null = null;
  if (bpp === 8) {
    const clrUsed = buf.readUInt32LE(46);
    const entries = clrUsed > 0 ? clrUsed : 256;
    const start = 14 + dibSize;
    if (start + entries * 4 > buf.length) throw new Error('BMP 팔레트가 잘렸습니다.');
    palette = buf.subarray(start, start + entries * 4); // B,G,R,예약 순
  }

  // 각 행은 4바이트 경계에 맞춰 패딩된다.
  const rowSize = (((bpp * width + 31) / 32) | 0) * 4;
  const dataStart = pixelOffset > 0 ? pixelOffset : 14 + dibSize + (palette?.length ?? 0);
  if (dataStart + rowSize * height > buf.length) throw new Error('BMP 픽셀 데이터가 잘렸습니다.');

  const out = Buffer.allocUnsafe(width * height * 3);
  for (let y = 0; y < height; y++) {
    // bottom-up 이면 파일의 마지막 행이 이미지의 첫 행이다.
    const srcRow = topDown ? y : height - 1 - y;
    const rowStart = dataStart + srcRow * rowSize;
    let o = y * width * 3;
    for (let x = 0; x < width; x++) {
      let b: number;
      let g: number;
      let r: number;
      if (bpp === 8) {
        const idx = buf[rowStart + x] * 4;
        b = palette![idx];
        g = palette![idx + 1];
        r = palette![idx + 2];
      } else {
        const p = rowStart + x * (bpp === 24 ? 3 : 4);
        b = buf[p];
        g = buf[p + 1];
        r = buf[p + 2];
      }
      out[o++] = r;
      out[o++] = g;
      out[o++] = b;
    }
  }

  return { data: out, width, height, channels: 3 };
}
