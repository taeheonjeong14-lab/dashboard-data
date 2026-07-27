/**
 * 업로드 직전 이미지 정규화 (브라우저 전용).
 *
 * 지금 하는 일은 하나 — **BMP 를 PNG 로 무손실 변환**한다.
 * 일부 치과 방사선·초음파 장비가 캡처를 BMP 로 내보내는데, BMP 는 무압축이라
 * 장당 850KB 를 넘기면서도 담고 있는 정보량은 그대로다. PNG 는 무손실 압축이라
 * **픽셀이 한 개도 바뀌지 않으면서** 용량이 절반 아래로 떨어진다(실측 856KB → 약 500KB).
 * 화질을 깎는 변환(JPEG 재인코딩·리사이즈)은 하지 않는다 — 진단 근거로 쓰는 사진이라
 * 원본 픽셀을 그대로 보존해야 한다.
 *
 * 변환에 실패하면 원본을 그대로 올린다. 서버(admin-web)에 BMP 디코더가 있으므로
 * 분석은 어느 쪽이든 정상 동작한다 — 여기서는 용량만 줄이는 것이 목적이다.
 */

// 브라우저·OS 에 따라 BMP 의 MIME 이 제각각이라 확장자도 함께 본다.
const BMP_MIME = new Set(['image/bmp', 'image/x-ms-bmp', 'image/x-bmp']);

function isBmp(file: File): boolean {
  return BMP_MIME.has(file.type.toLowerCase()) || /\.bmp$/i.test(file.name);
}

export async function normalizeImageForUpload(file: File): Promise<File> {
  if (!isBmp(file)) return file;
  try {
    // 브라우저는 BMP 디코딩을 기본 지원한다.
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    // 변환이 실패했거나 오히려 더 커졌으면 원본을 쓴다.
    if (!blob || blob.size === 0 || blob.size >= file.size) return file;

    return new File([blob], `${file.name.replace(/\.bmp$/i, '')}.png`, {
      type: 'image/png',
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  }
}

export async function normalizeImagesForUpload(files: File[]): Promise<File[]> {
  return Promise.all(files.map(normalizeImageForUpload));
}
