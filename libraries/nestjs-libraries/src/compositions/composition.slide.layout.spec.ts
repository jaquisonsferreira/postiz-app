import { Browser, chromium } from 'playwright-core';
import sharp from 'sharp';
import {
  buildSlideHtml,
  DEFAULT_BRAND,
  SlideSize,
} from '@gitroom/nestjs-libraries/compositions/composition.slide.template';

const SIZES: SlideSize[] = [
  { width: 1080, height: 1350 },
  { width: 1080, height: 1080 },
  { width: 1080, height: 1920 },
];

const longest = {
  kicker: 'K'.repeat(80),
  headline: 'Palavra '.repeat(25).slice(0, 200),
  body: ('Linha com conteúdo explicativo sobre o tema.\n'.repeat(14)).slice(0, 600),
};

describe('layout do slide', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
      args: ['--no-sandbox'],
    });
  });

  afterAll(async () => {
    await browser.close();
  });

  it.each(SIZES)('mantém o maior texto aceito dentro de $width×$height', async (size) => {
    const page = await browser.newPage({ viewport: size, javaScriptEnabled: false });
    await page.route('**/*', (route) =>
      route.request().url().startsWith('data:') ? route.continue() : route.abort()
    );
    await page.setContent(
      buildSlideHtml({
        slide: longest,
        index: 1,
        total: 5,
        size,
        brand: { ...DEFAULT_BRAND, name: 'N'.repeat(60), handle: '@'.padEnd(60, 'h') },
      }),
      { waitUntil: 'load' }
    );

    const text = await page.locator('.text').boundingBox();
    const bottom = await page.locator('.bottom').boundingBox();
    const top = await page.locator('.top').boundingBox();
    const kicker = await page.locator('.kicker').boundingBox();
    const brand = await page.locator('.brand').boundingBox();
    await page.close();

    expect(text && bottom && top).toBeTruthy();
    expect(text!.y).toBeGreaterThanOrEqual(top!.y + top!.height);
    expect(text!.y + text!.height).toBeLessThanOrEqual(bottom!.y);
    expect(bottom!.y + bottom!.height).toBeLessThanOrEqual(size.height);
    expect(kicker!.x + kicker!.width).toBeLessThanOrEqual(size.width);
    expect(brand!.x + brand!.width).toBeLessThanOrEqual(size.width);
    expect(text!.x + text!.width).toBeLessThanOrEqual(size.width);
  });
  it('mantém um logo muito largo dentro do espaço da marca', async () => {
    const size = SIZES[0];
    const wide = await sharp({
      create: { width: 4000, height: 50, channels: 3, background: '#000000' },
    })
      .png()
      .toBuffer();
    const page = await browser.newPage({ viewport: size, javaScriptEnabled: false });
    await page.route('**/*', (route) =>
      route.request().url().startsWith('data:') ? route.continue() : route.abort()
    );
    await page.setContent(
      buildSlideHtml({
        slide: longest,
        index: 0,
        total: 5,
        size,
        brand: {
          ...DEFAULT_BRAND,
          name: 'connectabil',
          logo: `data:image/png;base64,${wide.toString('base64')}`,
        },
      }),
      { waitUntil: 'load' }
    );

    const logo = await page.locator('.logo').boundingBox();
    const kicker = await page.locator('.kicker').boundingBox();
    await page.close();

    expect(logo!.x).toBeGreaterThanOrEqual(kicker!.x + kicker!.width);
    expect(logo!.x + logo!.width).toBeLessThanOrEqual(size.width);
  });
});
