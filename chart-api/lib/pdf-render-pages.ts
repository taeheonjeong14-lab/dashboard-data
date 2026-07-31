/**
 * PDF 페이지를 "통째로 렌더한 이미지(JPEG)"로 뽑는다 — 헤더 텍스트 + 페이지에 박힌 래스터 박스를
 * 한 장의 픽셀 이미지로 합쳐서 반환한다.
 *
 * 왜 필요한가:
 * 인투벳처럼 진료 본문(SOAP)을 "이미지 박스"로 넣는 차트는, 같은 페이지에 얇은 텍스트 헤더
 * (날짜·Subject·CC)가 함께 있으면 Gemini/Google Vision 이 그 페이지를 "디지털 텍스트 페이지"로
 * 판단해 텍스트 레이어만 읽고, 위에 얹힌 이미지 박스는 OCR/전사하지 않는다.
 * → [S] 주관 / [A] 평가 / [PL] 계획이 통째로 유실(텍스트레이어가 없는 페이지만 정상 OCR).
 *
 * 페이지를 픽셀 이미지로 렌더해서 넘기면 "텍스트 vs 이미지" 구분 자체가 사라지므로, 헤더 글자와
 * 이미지 박스가 한 장에 담겨 전부 시각 순서대로 전사된다(박스가 다음 진료 헤더 위에 있어도 순서 보존).
 *
 * pdfjs(렌더 엔진) + @napi-rs/canvas(2D 캔버스, prebuilt 네이티브) 조합. 둘 다 next.config 의
 * serverExternalPackages 에 등록해 번들에서 제외한다(네이티브 .node / 대형 ESM).
 */

// 동적 import 로 로드한 pdfjs 는 정적 타입이 무거워 any 로 둔다(런타임 검증 완료).
/* eslint-disable @typescript-eslint/no-explicit-any */

type CanvasModule = typeof import('@napi-rs/canvas');

let canvasModPromise: Promise<CanvasModule> | null = null;
async function getCanvasMod(): Promise<CanvasModule> {
  if (!canvasModPromise) {
    canvasModPromise = import('@napi-rs/canvas').then((m) => {
      const mod = (((m as unknown) as { default?: CanvasModule }).default ?? m) as CanvasModule;
      // pdfjs 렌더가 참조하는 브라우저 전역(DOMMatrix/Path2D/ImageData)이 Node 서버리스엔 없다.
      // @napi-rs/canvas 구현으로 전역 폴리필(pdfjs import 전에 걸어둔다).
      const g = globalThis as Record<string, unknown>;
      const src = mod as unknown as Record<string, unknown>;
      for (const k of ['DOMMatrix', 'Path2D', 'ImageData'] as const) {
        if (!g[k] && src[k]) g[k] = src[k];
      }
      return mod;
    });
  }
  return canvasModPromise;
}

let pdfjsPromise: Promise<any> | null = null;
async function getPdfjs(): Promise<any> {
  await getCanvasMod(); // 전역 폴리필을 먼저 건다.
  if (!pdfjsPromise) {
    // exports 맵이 없어 파일 경로를 직접 import 가능(검증됨). serverExternalPackages 로 런타임 해석.
    // (이 서브패스는 타입 선언을 제공하지 않아 any — getPdfjs 반환도 any)
    // @ts-expect-error pdfjs-dist/build/pdf.mjs 는 타입 선언이 없음
    pdfjsPromise = import('pdfjs-dist/build/pdf.mjs');
  }
  return pdfjsPromise;
}

function makeCanvasFactory(createCanvas: CanvasModule['createCanvas']) {
  return class NodeCanvasFactory {
    create(width: number, height: number) {
      const canvas = createCanvas(Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height)));
      return { canvas, context: canvas.getContext('2d') };
    }
    reset(cc: any, width: number, height: number) {
      cc.canvas.width = Math.max(1, Math.ceil(width));
      cc.canvas.height = Math.max(1, Math.ceil(height));
    }
    destroy(cc: any) {
      if (cc.canvas) {
        cc.canvas.width = 0;
        cc.canvas.height = 0;
      }
      cc.canvas = null;
      cc.context = null;
    }
  };
}

/**
 * `start1`..`end1`(1-base, 포함) 페이지를 각각 통째 렌더한 JPEG 버퍼 배열로 반환한다.
 * @param scale   렌더 배율(기본 2.0 ≈ 144dpi). 글자 OCR/전사에 충분하면서 용량 과하지 않음.
 * @param quality JPEG 품질 0~100(기본 82).
 */
export async function renderPdfPagesToJpegs(
  pdfBuffer: Buffer,
  start1: number,
  end1: number,
  opts?: { scale?: number; quality?: number },
): Promise<Buffer[]> {
  const scale = opts?.scale ?? 2.0;
  const quality = opts?.quality ?? 82;

  const canvasMod = await getCanvasMod();
  const { createCanvas } = canvasMod;
  const pdfjs = await getPdfjs();

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(pdfBuffer),
    CanvasFactory: makeCanvasFactory(createCanvas),
    isEvalSupported: false,
    // Node 캔버스엔 @font-face 로딩이 없으므로 글리프를 벡터 패스로 직접 그린다(임베디드 폰트 사용).
    disableFontFace: true,
  }).promise;

  try {
    const start = Math.max(1, Math.floor(start1));
    const end = Math.min(doc.numPages, Math.floor(end1));
    const out: Buffer[] = [];
    for (let p = start; p <= end; p += 1) {
      const page = await doc.getPage(p);
      try {
        const viewport = page.getViewport({ scale });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx as any, viewport }).promise;
        out.push(canvas.toBuffer('image/jpeg', quality));
      } finally {
        page.cleanup();
      }
    }
    return out;
  } finally {
    await doc.destroy().catch(() => {});
  }
}

export type PdfPageImageCoverage = {
  page: number;
  /** 페이지 면적 대비 래스터 이미지가 덮은 비율(0~1). 겹침은 보정하지 않는 근사치. */
  imageAreaRatio: number;
  imageCount: number;
  /** 그 페이지 텍스트 레이어 글자 수 (호출부가 charsByPage 로 채워 넣는다) */
  textChars: number;
};

/**
 * 페이지별 "래스터 이미지가 덮은 면적" 을 잰다 — 본문이 이미지로 들어간 PDF 를 가려내기 위함.
 *
 * 우리엔PMS 처럼 머리글·라벨은 진짜 텍스트인데 **SOAP 본문만 이미지**인 차트가 있다. 이때
 * 텍스트 레이어만 읽으면 `Subjective` 라벨까지만 나오고 그 아래 내용이 통째로 사라진다.
 * 실측(파스텔LC 4일치): 본문 페이지가 이미지 48% · 텍스트 280자 → 본문 전량 유실.
 *
 * 정확한 클리핑·겹침까지 계산하지 않는다. "이 페이지 상당 부분이 그림이다" 라는 **거친 신호**면
 * 충분하고, 임계값도 그 전제로 잡는다.
 */
export async function measurePdfImageCoverage(pdfBuffer: Buffer): Promise<PdfPageImageCoverage[]> {
  const pdfjs = await getPdfjs();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(pdfBuffer),
    isEvalSupported: false,
    disableFontFace: true,
  }).promise;
  try {
    const OPS = pdfjs.OPS;
    const paintOps = new Set(
      [OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintJpegXObject].filter(
        (v: unknown) => typeof v === 'number',
      ),
    );
    const out: PdfPageImageCoverage[] = [];
    for (let p = 1; p <= doc.numPages; p += 1) {
      const page = await doc.getPage(p);
      try {
        const vp = page.getViewport({ scale: 1 });
        const pageArea = Math.max(1, vp.width * vp.height);
        const ops = await page.getOperatorList();
        // CTM 을 save/restore/transform 으로 추적해 각 이미지가 실제로 차지하는 면적을 구한다.
        let ctm: number[] = [1, 0, 0, 1, 0, 0];
        const stack: number[][] = [];
        let imageArea = 0;
        let imageCount = 0;
        for (let k = 0; k < ops.fnArray.length; k += 1) {
          const fn = ops.fnArray[k];
          if (fn === OPS.save) {
            stack.push(ctm.slice());
          } else if (fn === OPS.restore) {
            ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
          } else if (fn === OPS.transform) {
            const m = ops.argsArray[k] as number[];
            // ctm = m × ctm (pdfjs 는 [a,b,c,d,e,f])
            ctm = [
              m[0] * ctm[0] + m[1] * ctm[2],
              m[0] * ctm[1] + m[1] * ctm[3],
              m[2] * ctm[0] + m[3] * ctm[2],
              m[2] * ctm[1] + m[3] * ctm[3],
              m[4] * ctm[0] + m[5] * ctm[2] + ctm[4],
              m[4] * ctm[1] + m[5] * ctm[3] + ctm[5],
            ];
          } else if (paintOps.has(fn)) {
            imageCount += 1;
            // 단위 정사각형(0..1)이 CTM 으로 변환된 넓이 = |det|
            imageArea += Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]);
          }
        }
        out.push({
          page: p,
          imageAreaRatio: Math.min(1, imageArea / pageArea),
          imageCount,
          textChars: 0,
        });
      } finally {
        page.cleanup();
      }
    }
    return out;
  } finally {
    await doc.destroy().catch(() => {});
  }
}

/**
 * "본문이 이미지로 들어간 페이지"가 있는지 — 텍스트 레이어를 주 경로로 믿어도 되는지 판정한다.
 * 이미지가 페이지를 크게 덮는데 그 페이지 텍스트가 적으면, 텍스트 레이어는 머리글·라벨만 읽은 것이다.
 */
export function hasImagedBodyPage(
  coverage: PdfPageImageCoverage[],
  charsByPage: Map<number, number>,
  opts?: { minImageAreaRatio?: number; maxTextChars?: number },
): boolean {
  const minRatio = opts?.minImageAreaRatio ?? 0.25;
  const maxChars = opts?.maxTextChars ?? 800;
  return coverage.some(
    (c) => c.imageAreaRatio >= minRatio && (charsByPage.get(c.page) ?? 0) < maxChars,
  );
}
