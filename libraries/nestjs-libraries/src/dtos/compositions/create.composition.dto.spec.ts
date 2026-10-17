import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCompositionDto } from '@gitroom/nestjs-libraries/dtos/compositions/create.composition.dto';

const slide = (n: number) => ({ kicker: `Ponto ${n}`, headline: `Título ${n}`, body: 'Corpo' });

const payload = (overrides: Record<string, unknown> = {}) => ({
  date: '2026-10-20T12:00:00.000Z',
  format: 'carousel',
  slides: [slide(1), slide(2), slide(3)],
  targets: [{ integrationId: 'ig-1', content: 'Legenda' }],
  ...overrides,
});

const errorsOf = async (body: Record<string, unknown>): Promise<string[]> => {
  const errors = await validate(plainToInstance(CreateCompositionDto, body));
  const flatten = (list: typeof errors, prefix = ''): string[] =>
    list.flatMap((e) => [
      ...(e.constraints ? [`${prefix}${e.property}`] : []),
      ...flatten(e.children || [], `${prefix}${e.property}.`),
    ]);
  return flatten(errors);
};

describe('CreateCompositionDto', () => {
  it('aceita um carrossel completo', async () => {
    expect(
      await errorsOf(
        payload({
          requiresApproval: true,
          size: 'portrait',
          brand: {
            primaryColor: '#6D4AFF',
            darkColor: '#17151F',
            lightColor: '#FFFFFF',
            headingFont: 'Bricolage Grotesque',
            bodyFont: 'Manrope',
            name: 'connectabil',
            handle: '@connectabil',
            logoUrl: 'https://cdn.example.com/logo.png',
          },
          slides: [
            { ...slide(1), theme: 'accent', background: { type: 'ai', prompt: 'escritório moderno' } },
            { ...slide(2), background: { type: 'url', url: 'https://cdn.example.com/bg.jpg' } },
          ],
          targets: [
            { integrationId: 'ig-1', content: 'Legenda', settings: { post_type: 'post' } },
            { integrationId: 'x-1', content: 'Fio 1', comments: ['Fio 2'] },
          ],
          tags: [{ value: 'reforma', label: 'Reforma' }],
        })
      )
    ).toEqual([]);
  });

  it('aceita imagem única e post só de texto', async () => {
    expect(await errorsOf(payload({ format: 'image', slides: [slide(1)] }))).toEqual([]);
    expect(await errorsOf(payload({ format: 'text', slides: undefined }))).toEqual([]);
  });

  it('exige de 2 a 10 slides no carrossel', async () => {
    expect(await errorsOf(payload({ slides: [slide(1)] }))).toContain('slides');
    expect(
      await errorsOf(payload({ slides: Array.from({ length: 11 }, (_, i) => slide(i)) }))
    ).toContain('slides');
  });

  it('exige exatamente 1 slide na imagem', async () => {
    expect(await errorsOf(payload({ format: 'image', slides: [slide(1), slide(2)] }))).toContain(
      'slides'
    );
    expect(await errorsOf(payload({ format: 'image', slides: undefined }))).toContain('slides');
  });

  it('não aceita slides em post só de texto', async () => {
    expect(await errorsOf(payload({ format: 'text' }))).toContain('slides');
  });

  it('rejeita formato desconhecido', async () => {
    expect(await errorsOf(payload({ format: 'video' }))).toContain('format');
  });

  it('exige data ISO', async () => {
    expect(await errorsOf(payload({ date: 'amanhã' }))).toContain('date');
  });

  it('exige ao menos um canal com integração e legenda', async () => {
    expect(await errorsOf(payload({ targets: [] }))).toContain('targets');
    expect(await errorsOf(payload({ targets: [{ content: 'x' }] }))).toContain(
      'targets.0.integrationId'
    );
    expect(await errorsOf(payload({ targets: [{ integrationId: 'ig-1' }] }))).toContain(
      'targets.0.content'
    );
  });

  it('valida cores e fontes da marca', async () => {
    const errors = await errorsOf(
      payload({ brand: { primaryColor: 'red', headingFont: "x');@import" } })
    );

    expect(errors).toEqual(expect.arrayContaining(['brand.primaryColor', 'brand.headingFont']));
  });

  it('exige prompt no fundo gerado por IA', async () => {
    expect(
      await errorsOf(payload({ slides: [{ ...slide(1), background: { type: 'ai' } }, slide(2)] }))
    ).toContain('slides.0.background.prompt');
  });

  it('exige URL HTTPS no fundo por URL e no logo', async () => {
    expect(
      await errorsOf(
        payload({
          slides: [
            { ...slide(1), background: { type: 'url', url: 'http://cdn.example.com/a.jpg' } },
            slide(2),
          ],
          brand: { logoUrl: 'ftp://x/logo.png' },
        })
      )
    ).toEqual(expect.arrayContaining(['slides.0.background.url', 'brand.logoUrl']));
  });

  it('limita o tamanho dos textos do slide', async () => {
    expect(
      await errorsOf(payload({ slides: [{ headline: 'x'.repeat(201) }, slide(2)] }))
    ).toContain('slides.0.headline');
  });

  it('rejeita tema e tamanho desconhecidos', async () => {
    const errors = await errorsOf(
      payload({ size: 'banner', slides: [{ ...slide(1), theme: 'neon' }, slide(2)] })
    );

    expect(errors).toEqual(expect.arrayContaining(['size', 'slides.0.theme']));
  });

  it('rejeita slides que não sejam lista, inclusive em post só de texto', async () => {
    expect(await errorsOf(payload({ format: 'text', slides: 'invalid' }))).toContain('slides');
    expect(await errorsOf(payload({ slides: 'invalid' }))).toContain('slides');
  });

  it('exige que o fundo do slide seja um objeto', async () => {
    expect(
      await errorsOf(payload({ slides: [{ ...slide(1), background: [] }, slide(2)] }))
    ).toContain('slides.0.background');
  });

  it('exige que cada slide seja um objeto', async () => {
    expect(await errorsOf(payload({ slides: [[], []] }))).toContain('slides');
  });
  it('recusa slide sem texto nem fundo', async () => {
    expect(await errorsOf(payload({ slides: [{}, slide(2)] }))).toContain('slides');
    expect(await errorsOf(payload({ slides: [{ headline: '  ' }, slide(2)] }))).toContain(
      'slides'
    );
    expect(
      await errorsOf(
        payload({ slides: [{ background: { type: 'ai', prompt: 'escritório' } }, slide(2)] })
      )
    ).toEqual([]);
  });

  it('exige que cada canal seja um objeto', async () => {
    expect(await errorsOf(payload({ targets: [[]] }))).toContain('targets');
  });

  it('limita a quantidade e o tamanho das tags', async () => {
    expect(
      await errorsOf(
        payload({ tags: Array.from({ length: 21 }, (_, i) => ({ value: `t${i}`, label: `T${i}` })) })
      )
    ).toContain('tags');
    expect(
      await errorsOf(payload({ tags: [{ value: 'x'.repeat(101), label: 'y'.repeat(101) }] }))
    ).toEqual(expect.arrayContaining(['tags.0.value', 'tags.0.label']));
  });
  it('limita o tamanho das configurações do provider', async () => {
    expect(
      await errorsOf(
        payload({ targets: [{ integrationId: 'ig-1', content: 'x', settings: { big: 'a'.repeat(30000) } }] })
      )
    ).toContain('targets.0.settings');
    expect(
      await errorsOf(
        payload({ targets: [{ integrationId: 'ig-1', content: 'x', settings: { post_type: 'post' } }] })
      )
    ).toEqual([]);
  });
});
