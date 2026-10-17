import {
  buildSlideHtml,
  DEFAULT_BRAND,
  resolveSlideTheme,
  SlideTemplateInput,
} from '@gitroom/nestjs-libraries/compositions/composition.slide.template';
import { CompositionValidationError } from '@gitroom/nestjs-libraries/compositions/composition.errors';

const input = (overrides: Partial<SlideTemplateInput> = {}): SlideTemplateInput => ({
  slide: {
    kicker: 'Reforma Tributária',
    headline: '5 pontos que sua empresa precisa acompanhar',
    body: 'Arraste para o lado →',
  },
  index: 0,
  total: 7,
  size: { width: 1080, height: 1350 },
  brand: { ...DEFAULT_BRAND, handle: '@connectabil' },
  ...overrides,
});

describe('resolveSlideTheme', () => {
  it('usa accent na capa, dark no último slide e light no meio', () => {
    expect(resolveSlideTheme(0, 7)).toBe('accent');
    expect(resolveSlideTheme(3, 7)).toBe('light');
    expect(resolveSlideTheme(6, 7)).toBe('dark');
  });

  it('não força dark no último slide de um carrossel de dois', () => {
    expect(resolveSlideTheme(1, 2)).toBe('light');
  });

  it('usa accent para imagem única', () => {
    expect(resolveSlideTheme(0, 1)).toBe('accent');
  });

  it('respeita o tema informado', () => {
    expect(resolveSlideTheme(0, 7, 'dark')).toBe('dark');
  });
});

describe('buildSlideHtml', () => {
  it('renderiza kicker, título, corpo e handle', () => {
    const html = buildSlideHtml(input());

    expect(html).toContain('Reforma Tributária');
    expect(html).toContain('5 pontos que sua empresa precisa acompanhar');
    expect(html).toContain('Arraste para o lado →');
    expect(html).toContain('@connectabil');
  });

  it('escapa HTML do conteúdo', () => {
    const html = buildSlideHtml(
      input({
        slide: { headline: '<script>alert("x")</script>', body: 'a & b' },
      })
    );

    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).toContain('a &amp; b');
  });

  it('mostra a posição apenas em carrosséis', () => {
    expect(buildSlideHtml(input({ index: 1 }))).toContain('2/7');
    expect(buildSlideHtml(input({ index: 0, total: 1 }))).not.toContain('1/1');
  });

  it('fixa as dimensões do slide', () => {
    const html = buildSlideHtml(input({ size: { width: 1080, height: 1080 } }));

    expect(html).toContain('width: 1080px');
    expect(html).toContain('height: 1080px');
  });

  it('aplica as cores do tema accent na capa', () => {
    const html = buildSlideHtml(
      input({ brand: { ...DEFAULT_BRAND, primaryColor: '#123ABC' } })
    );

    expect(html).toContain('--background: #123ABC');
  });

  it('aplica a cor escura no último slide', () => {
    const html = buildSlideHtml(
      input({ index: 6, brand: { ...DEFAULT_BRAND, darkColor: '#101010' } })
    );

    expect(html).toContain('--background: #101010');
  });

  it('carrega as fontes da marca do Google Fonts', () => {
    const html = buildSlideHtml(
      input({
        brand: { ...DEFAULT_BRAND, headingFont: 'Space Grotesk', bodyFont: 'DM Sans' },
      })
    );

    expect(html).toContain('family=Space+Grotesk:wght@600;700');
    expect(html).toContain('family=DM+Sans:wght@400;500;700');
    expect(html).toContain("'Space Grotesk'");
  });

  it('usa imagem de fundo com sobreposição para legibilidade', () => {
    const html = buildSlideHtml(
      input({ backgroundImage: 'data:image/png;base64,AAAA' })
    );

    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).toContain('class="overlay"');
  });

  it('inclui o logo da marca quando informado', () => {
    const html = buildSlideHtml(
      input({ brand: { ...DEFAULT_BRAND, logo: 'data:image/png;base64,BBBB' } })
    );

    expect(html).toContain('src="data:image/png;base64,BBBB"');
  });

  it('rejeita imagem de fundo que não seja data URI de imagem', () => {
    expect(() =>
      buildSlideHtml(input({ backgroundImage: 'https://example.com/a.png' }))
    ).toThrow(CompositionValidationError);
  });

  it('rejeita cores fora do formato hexadecimal', () => {
    expect(() =>
      buildSlideHtml(
        input({ brand: { ...DEFAULT_BRAND, primaryColor: 'red;}body{display:none' } })
      )
    ).toThrow(CompositionValidationError);
  });

  it('rejeita nomes de fonte com caracteres inválidos', () => {
    expect(() =>
      buildSlideHtml(
        input({ brand: { ...DEFAULT_BRAND, headingFont: "x');@import url(evil" } })
      )
    ).toThrow(CompositionValidationError);
  });

  it('rejeita slide sem nenhum conteúdo e sem imagem', () => {
    expect(() => buildSlideHtml(input({ slide: {} }))).toThrow(
      CompositionValidationError
    );
  });
});
