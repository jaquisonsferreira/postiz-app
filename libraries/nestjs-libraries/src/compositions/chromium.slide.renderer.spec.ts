import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import sharp from 'sharp';
import { ChromiumSlideRenderer } from '@gitroom/nestjs-libraries/compositions/chromium.slide.renderer';

const page = (body: string, width: number, height: number) =>
  `<!doctype html><html><head><style>html,body{margin:0}body{width:${width}px;height:${height}px}</style></head><body>${body}</body></html>`;

describe('ChromiumSlideRenderer', () => {
  let renderer: ChromiumSlideRenderer;
  let server: Server;
  let hits = 0;
  let serverUrl = '';

  beforeAll(async () => {
    renderer = new ChromiumSlideRenderer({
      executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
    });
    server = createServer((req, res) => {
      hits++;
      res.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await renderer.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('gera um PNG com as dimensões exatas do slide', async () => {
    const png = await renderer.render(page('<div>Olá</div>', 1080, 1350), {
      width: 1080,
      height: 1350,
    });

    const metadata = await sharp(png).metadata();
    expect(metadata.format).toBe('png');
    expect(metadata.width).toBe(1080);
    expect(metadata.height).toBe(1350);
  });

  it('pinta o conteúdo do HTML', async () => {
    const png = await renderer.render(
      page('<div style="width:100%;height:100%;background:#6D4AFF"></div>', 200, 200),
      { width: 200, height: 200 }
    );

    const { data } = await sharp(png)
      .extract({ left: 100, top: 100, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect([data[0], data[1], data[2]]).toEqual([0x6d, 0x4a, 0xff]);
  });

  it('bloqueia requisições de rede fora da lista permitida', async () => {
    hits = 0;
    await renderer.render(
      page(`<img src="${serverUrl}/pixel.png"><link rel="stylesheet" href="${serverUrl}/a.css">`, 100, 100),
      { width: 100, height: 100 }
    );

    expect(hits).toBe(0);
  });

  it('renderiza vários slides em sequência reaproveitando o navegador', async () => {
    const sizes = [1, 2, 3].map(() => ({ width: 120, height: 150 }));
    const pngs = await Promise.all(
      sizes.map((size, i) => renderer.render(page(`<p>${i}</p>`, size.width, size.height), size))
    );

    for (const png of pngs) {
      expect((await sharp(png).metadata()).width).toBe(120);
    }
  });
});
