import { Browser, chromium } from 'playwright-core';
import type { SlideSize } from '@gitroom/nestjs-libraries/compositions/composition.slide.template';

export interface SlideRenderer {
  render(html: string, size: SlideSize): Promise<Buffer>;
  close(): Promise<void>;
}

export interface ChromiumSlideRendererOptions {
  executablePath?: string;
  allowedOrigins?: string[];
  timeoutMs?: number;
}

const DEFAULT_ALLOWED_ORIGINS = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];

// Scripts stay disabled, so the wait for the fonts is on the network going
// idle: the font files are fetched after the stylesheet, before that point.
// The slide HTML carries user text and is rendered on our servers, so the page
// may only reach the font CDN: everything else (an <img> pointing at an internal
// address, a stylesheet on a private host) is aborted before it leaves Chromium
export class ChromiumSlideRenderer implements SlideRenderer {
  private _browser: Promise<Browser> | null = null;
  private readonly _allowedOrigins: Set<string>;
  private readonly _timeoutMs: number;

  constructor(private readonly _options: ChromiumSlideRendererOptions = {}) {
    this._allowedOrigins = new Set(_options.allowedOrigins || DEFAULT_ALLOWED_ORIGINS);
    this._timeoutMs = _options.timeoutMs || 30000;
  }

  private browser(): Promise<Browser> {
    if (!this._browser) {
      this._browser = chromium
        .launch({
          executablePath: this._options.executablePath,
          args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
        })
        .catch((err: unknown) => {
          this._browser = null;
          throw err;
        });
    }
    return this._browser;
  }

  private isAllowed(url: string): boolean {
    if (url.startsWith('data:')) {
      return true;
    }
    try {
      return this._allowedOrigins.has(new URL(url).origin);
    } catch {
      return false;
    }
  }

  async render(html: string, size: SlideSize): Promise<Buffer> {
    const context = await (await this.browser()).newContext({
      viewport: size,
      deviceScaleFactor: 1,
      javaScriptEnabled: false,
    });

    try {
      await context.route('**/*', (route) =>
        this.isAllowed(route.request().url()) ? route.continue() : route.abort('blockedbyclient')
      );
      const page = await context.newPage();
      page.setDefaultTimeout(this._timeoutMs);
      await page.setContent(html, { waitUntil: 'networkidle', timeout: this._timeoutMs });
      return await page.screenshot({
        type: 'png',
        clip: { x: 0, y: 0, width: size.width, height: size.height },
      });
    } finally {
      await context.close();
    }
  }

  async close(): Promise<void> {
    if (!this._browser) {
      return;
    }
    const browser = await this._browser;
    this._browser = null;
    await browser.close();
  }
}
