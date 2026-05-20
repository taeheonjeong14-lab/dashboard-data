import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const KOREAN_FONT_URLS = [
  'https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main/Sans/OTF/Korean/NotoSansCJKkr-Regular.otf',
  'https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main/Sans/OTF/Korean/NotoSansCJKkr-Bold.otf',
];

let koreanFontsRegistered: Promise<void> | null = null;
let browserInstancePromise: Promise<import('playwright-core').Browser> | null = null;
let browserIdleTimer: NodeJS.Timeout | null = null;

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
    const current = browserInstancePromise;
    browserInstancePromise = null;
    browserIdleTimer = null;
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
  scheduleBrowserIdleClose();
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
      const imgs = Array.from(document.images ?? []);
      await Promise.all(
        imgs.map(async (img) => {
          if (!img.src) return;
          if (!img.complete || img.naturalWidth === 0) {
            await new Promise<void>((resolve) => {
              let done = false;
              const finish = () => {
                if (done) return;
                done = true;
                resolve();
              };
              img.addEventListener('load', finish, { once: true });
              img.addEventListener('error', finish, { once: true });
              setTimeout(finish, 7000);
            });
          }
          if (typeof img.decode === 'function') {
            await img.decode().catch(() => undefined);
          }
        }),
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
  }
}

