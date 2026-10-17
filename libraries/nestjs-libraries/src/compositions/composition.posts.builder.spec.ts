import {
  buildCompositionPosts,
  captionToHtml,
  compositionPostIds,
  CompositionPostsInput,
} from '@gitroom/nestjs-libraries/compositions/composition.posts.builder';
import { CompositionValidationError } from '@gitroom/nestjs-libraries/compositions/composition.errors';

const input = (overrides: Partial<CompositionPostsInput> = {}): CompositionPostsInput => ({
  date: '2026-10-20T12:00:00.000Z',
  requiresApproval: false,
  compositionId: 'cmp1',
  media: [
    { id: 'm1', path: 'https://cdn.example.com/1.png' },
    { id: 'm2', path: 'https://cdn.example.com/2.png' },
  ],
  targets: [
    {
      integrationId: 'ig-1',
      providerIdentifier: 'instagram',
      content: 'Legenda do Instagram',
      settings: { post_type: 'post' },
    },
    {
      integrationId: 'li-1',
      providerIdentifier: 'linkedin-page',
      content: 'Legenda do LinkedIn',
      settings: { post_as_images_carousel: true, carousel_name: 'Reforma' },
    },
  ],
  ...overrides,
});

describe('captionToHtml', () => {
  it('converte linhas em parágrafos preservando linhas vazias', () => {
    expect(captionToHtml('Linha 1\n\nLinha 3')).toBe('<p>Linha 1</p><p></p><p>Linha 3</p>');
  });

  it('escapa HTML da legenda', () => {
    expect(captionToHtml('a & <b>')).toBe('<p>a &amp; &lt;b&gt;</p>');
  });

  it('normaliza quebras de linha do Windows', () => {
    expect(captionToHtml('a\r\nb')).toBe('<p>a</p><p>b</p>');
  });
});

describe('buildCompositionPosts', () => {
  it('agenda quando não exige aprovação', () => {
    const body = buildCompositionPosts(input());

    expect(body.type).toBe('schedule');
    expect(body.date).toBe('2026-10-20T12:00:00.000Z');
    expect(body.shortLink).toBe(false);
    expect(body.tags).toEqual([]);
  });

  it('cria rascunho quando exige aprovação', () => {
    expect(buildCompositionPosts(input({ requiresApproval: true })).type).toBe('draft');
  });

  it('cria um post por canal com o provider nas configurações', () => {
    const body = buildCompositionPosts(input());

    expect(body.posts).toHaveLength(2);
    expect(body.posts[0].integration.id).toBe('ig-1');
    expect(body.posts[0].settings).toEqual({ __type: 'instagram', post_type: 'post' });
    expect(body.posts[1].settings).toEqual({
      __type: 'linkedin-page',
      post_as_images_carousel: true,
      carousel_name: 'Reforma',
    });
  });

  it('gera ids estáveis por canal e item para que um retry não duplique posts', () => {
    const first = buildCompositionPosts(
      input({
        targets: [
          { integrationId: 'x-1', providerIdentifier: 'x', content: 'a', comments: ['b'] },
          { integrationId: 'ig-1', providerIdentifier: 'instagram', content: 'c' },
        ],
      })
    );
    const ids = first.posts.map((p) => p.value.map((v) => v.id));

    expect(ids).toEqual([
      ['cmp1-0-0', 'cmp1-0-1'],
      ['cmp1-1-0'],
    ]);
  });

  it('anexa as mídias renderizadas ao post principal de cada canal', () => {
    const body = buildCompositionPosts(input());

    expect(body.posts[0].value[0].content).toBe('<p>Legenda do Instagram</p>');
    expect(body.posts[0].value[0].image).toEqual([
      { id: 'm1', path: 'https://cdn.example.com/1.png' },
      { id: 'm2', path: 'https://cdn.example.com/2.png' },
    ]);
  });

  it('transforma comentários em itens seguintes sem mídia', () => {
    const body = buildCompositionPosts(
      input({
        targets: [
          {
            integrationId: 'x-1',
            providerIdentifier: 'x',
            content: 'Fio 1/3',
            comments: ['Fio 2/3', 'Fio 3/3'],
          },
        ],
      })
    );

    expect(body.posts[0].value.map((v) => v.content)).toEqual([
      '<p>Fio 1/3</p>',
      '<p>Fio 2/3</p>',
      '<p>Fio 3/3</p>',
    ]);
    expect(body.posts[0].value[1].image).toEqual([]);
  });

  it('repassa as tags', () => {
    const body = buildCompositionPosts(
      input({ tags: [{ value: 'reforma', label: 'Reforma' }] })
    );

    expect(body.tags).toEqual([{ value: 'reforma', label: 'Reforma' }]);
  });

  it('não permite que settings sobrescreva o provider', () => {
    const body = buildCompositionPosts(
      input({
        targets: [
          {
            integrationId: 'ig-1',
            providerIdentifier: 'instagram',
            content: 'x',
            settings: { __type: 'x' },
          },
        ],
      })
    );

    expect((body.posts[0].settings as { __type: string }).__type).toBe('instagram');
  });

  it('exige ao menos um canal', () => {
    expect(() => buildCompositionPosts(input({ targets: [] }))).toThrow(
      CompositionValidationError
    );
  });
});

describe('compositionPostIds', () => {
  it('calcula os ids dos posts principais de cada canal sem depender do que foi gravado', () => {
    const body = buildCompositionPosts(input());

    expect(compositionPostIds('cmp1', 2)).toEqual(body.posts.map((p) => p.value[0].id));
  });
});
