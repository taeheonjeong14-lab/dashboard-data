import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const KOREAN_FONT_URLS = [
  'https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main/Sans/OTF/Korean/NotoSansCJKkr-Regular.otf',
  'https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main/Sans/OTF/Korean/NotoSansCJKkr-Bold.otf',
];

let koreanFontsRegistered: Promise<void> | null = null;
let browserInstancePromise: Promise<import('playwright-core').Browser> | null = null;
let browserIdleTimer: NodeJS.Timeout | null = null;
// 진행 중인 PDF 렌더 수. >0 이면 공유 브라우저를 닫지 않는다(렌더 도중 닫혀 'target closed' 나는 것 방지).
let activeRenders = 0;

const BROWSER_IDLE_CLOSE_MS = 45_000;

async function ensureKoreanFonts() {
  if (koreanFontsRegistered) return koreanFontsRegistered;
  koreanFontsRegistered = (async () => {
    const chromiumBinary = (await import('@sparticuz/chromium')).default;
    const fontLoader = chromiumBinary as unknown as { font?: (input: string) => Promise<void> };
    for (const fontUrl of KOREAN_FONT_URLS) {
      try {
        if (fontLoader.font) {
          await fontLoader.font(fontUrl);
        }
      } catch {
        // Keep PDF generation running even if remote font fetch fails.
      }
    }
  })();
  return koreanFontsRegistered;
}

export async function launchPlaywrightChromium() {
  const [{ chromium }, chromiumBinary] = await Promise.all([
    import('playwright-core'),
    import('@sparticuz/chromium'),
    ensureKoreanFonts(),
  ]);
  const executablePath = await (async () => {
    if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
      return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    }
    try {
      // Happy path: binary is bundled in node_modules (works locally or on Pro plan).
      return await chromiumBinary.default.executablePath();
    } catch {
      // Binary not in node_modules (Vercel Hobby excludes files >50 MB from the bundle).
      // Fall back to downloading from GitHub Releases at runtime.
      // executablePath(url) downloads the pack.tar, caches in /tmp, returns the path.
      const pkgJson = JSON.parse(
        readFileSync(resolve(require.resolve('@sparticuz/chromium'), '../../package.json'), 'utf-8'),
      ) as { version: string };
      const url = `https://github.com/Sparticuz/chromium/releases/download/v${pkgJson.version}/chromium-v${pkgJson.version}-pack.tar`;
      return await chromiumBinary.default.executablePath(url);
    }
  })();
  const baseOptions: Parameters<typeof chromium.launch>[0] = {
    headless: true,
    args: chromiumBinary.default.args,
  };

  const isDesktop = process.platform === 'win32' || process.platform === 'darwin';
  const launchErrors: string[] = [];

  if (executablePath && existsSync(executablePath)) {
    try {
      return await chromium.launch({ ...baseOptions, executablePath });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      launchErrors.push(`executablePath launch failed: ${message}`);
    }
  } else if (executablePath) {
    launchErrors.push(`executablePath not found: ${executablePath}`);
  }

  // Local fallback when packaged Chromium is unavailable/stale.
  if (isDesktop) {
    try {
      return await chromium.launch({ ...baseOptions, channel: 'chrome' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      launchErrors.push(`chrome channel launch failed: ${message}`);
    }
  }

  try {
    return await chromium.launch(baseOptions);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    launchErrors.push(`default launch failed: ${message}`);
    throw new Error(launchErrors.join(' | '));
  }
}

function scheduleBrowserIdleClose() {
  if (browserIdleTimer) {
    clearTimeout(browserIdleTimer);
  }
  browserIdleTimer = setTimeout(async () => {
    browserIdleTimer = null;
    if (activeRenders > 0) return; // 렌더 진행 중이면 닫지 않는다.
    const current = browserInstancePromise;
    browserInstancePromise = null;
    if (!current) return;
    try {
      const browser = await current;
      if (browser.isConnected()) {
        await browser.close();
      }
    } catch {
      // Ignore best-effort idle cleanup errors.
    }
  }, BROWSER_IDLE_CLOSE_MS);
  browserIdleTimer.unref?.();
}

export async function getSharedPlaywrightBrowser() {
  if (!browserInstancePromise) {
    browserInstancePromise = launchPlaywrightChromium();
  }
  const browser = await browserInstancePromise;
  if (!browser.isConnected()) {
    browserInstancePromise = launchPlaywrightChromium();
    return browserInstancePromise;
  }
  return browser;
}

type PdfMargin = {
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
};

export type RenderPdfFromPageUrlOptions = {
  margin?: PdfMargin;
  /** Vercel 로그·클라 상관 ID (`[export-pdf] rid=` 와 맞춤) */
  requestId?: string;
};

export async function renderPdfFromPageUrl(url: string, options?: RenderPdfFromPageUrlOptions) {
  const rid = options?.requestId?.trim() ? `[rid=${options.requestId}] ` : '';
  const t0 = Date.now();
  // 렌더 시작: 유휴 종료 타이머를 멈춰 렌더 도중 브라우저가 닫히지 않게 한다.
  activeRenders += 1;
  if (browserIdleTimer) {
    clearTimeout(browserIdleTimer);
    browserIdleTimer = null;
  }
  const browser = await getSharedPlaywrightBrowser();
  const t1 = Date.now();
  const page = await browser.newPage();
  try {
    // `networkidle` 은 RSC/스트림·장시간 폴링에서 거의 도달하지 않아 타임아웃·람다 초과로 클라이언트가 ERR_FAILED 로 보기 쉽다.
    await page.goto(url, { waitUntil: 'load', timeout: 90_000 });
    // 인쇄 페이지가 정상이면 표지 루트에 `.report-a4-tokens` 가 있다. 보호 배포/404/다른 호스트로 가면 없어서 여기서 멈춘다.
    try {
      await page.waitForSelector('.report-a4-tokens', { state: 'visible', timeout: 25_000 });
    } catch {
      console.warn(`${rid}[pdf] .report-a4-tokens wait skipped or timed out — url=`, url);
      await page.waitForTimeout(800);
    }
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(async () => {
      // 이미지당 대기 상한 — 케이스 이미지가 많거나 스토리지가 느려도 깨지지 않도록 넉넉히.
      const PER_IMG_TIMEOUT = 15_000;
      // 로드 실패(error)·타임아웃 시 캐시 우회 재시도 횟수.
      const MAX_ATTEMPTS = 3;
      // 동시 로드 수 제한 — 대역폭 경쟁으로 개별 이미지가 타임아웃되는 것을 줄인다.
      const CONCURRENCY = 6;

      const imgs = Array.from(document.images ?? []).filter((img) => img.src);

      const loadOne = (img: HTMLImageElement) =>
        new Promise<void>((resolve) => {
          if (img.complete && img.naturalWidth > 0) return resolve();
          const original = img.src;
          let attempt = 0;
          let timer: ReturnType<typeof setTimeout> | undefined;

          const cleanup = () => {
            if (timer) clearTimeout(timer);
            img.removeEventListener('load', onLoad);
            img.removeEventListener('error', onError);
          };
          const onLoad = () => {
            cleanup();
            resolve();
          };
          const fail = () => {
            cleanup();
            if (attempt < MAX_ATTEMPTS) {
              attempt += 1;
              // 캐시 우회 재시도. Supabase 서명 URL 은 추가 쿼리 파라미터에 영향받지 않는다.
              try {
                const u = new URL(original, location.href);
                u.searchParams.set('__retry', `${attempt}-${Date.now()}`);
                img.src = u.toString();
              } catch {
                img.src = original;
              }
              arm();
            } else {
              // 최종 실패 — 한 장 때문에 전체 PDF 를 막지는 않는다(로그/검증은 별도).
              resolve();
            }
          };
          const onError = () => fail();
          function arm() {
            img.addEventListener('load', onLoad, { once: true });
            img.addEventListener('error', onError, { once: true });
            timer = setTimeout(() => {
              if (img.naturalWidth > 0) {
                cleanup();
                resolve();
              } else {
                fail();
              }
            }, PER_IMG_TIMEOUT);
          }
          arm();
        });

      let cursor = 0;
      const workers = Array.from({ length: Math.min(CONCURRENCY, imgs.length) }, async () => {
        while (cursor < imgs.length) {
          const img = imgs[cursor];
          cursor += 1;
          await loadOne(img);
        }
      });
      await Promise.all(workers);

      // 디코드까지 끝내 렌더 준비를 보장.
      await Promise.all(
        imgs.map((img) => (typeof img.decode === 'function' ? img.decode().catch(() => undefined) : undefined)),
      );
    });
    const t2 = Date.now();
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: options?.margin ?? { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
    });
    const t3 = Date.now();
    console.info(
      `${rid}[pdf] url render timing launchOrReuse=${t1 - t0}ms render=${t2 - t1}ms pdf=${t3 - t2}ms total=${t3 - t0}ms`,
    );
    return pdf;
  } finally {
    await page.close().catch(() => undefined);
    activeRenders = Math.max(0, activeRenders - 1);
    // 마지막 렌더가 끝나면 그때부터 유휴 종료 타이머를 건다(진행 중이면 안 닫힘).
    if (activeRenders === 0) scheduleBrowserIdleClose();
  }
}

