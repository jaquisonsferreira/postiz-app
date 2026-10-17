import sharp from 'sharp';
import { TemporalService } from 'nestjs-temporal-core';
import { CompositionService } from '@gitroom/nestjs-libraries/database/prisma/compositions/composition.service';
import { CompositionRepository } from '@gitroom/nestjs-libraries/database/prisma/compositions/composition.repository';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';

// The collaborators are replaced by the stubs of each test: their modules load
// ESM-only packages that Jest can't require
jest.mock('@gitroom/nestjs-libraries/database/prisma/integrations/integration.service', () => ({
  IntegrationService: class IntegrationService {},
}));
jest.mock('@gitroom/nestjs-libraries/database/prisma/posts/posts.service', () => ({
  PostsService: class PostsService {},
}));
jest.mock('@gitroom/nestjs-libraries/database/prisma/media/media.service', () => ({
  MediaService: class MediaService {},
}));
jest.mock('@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service', () => ({
  SubscriptionService: class SubscriptionService {},
}));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class IntegrationManager {},
}));
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: {
    createStorage: () => ({ uploadSimple: async () => '/uploads/slide.png' }),
  },
}));

const storedComposition = (payload: Record<string, unknown>, posts: unknown[] = []) => ({
  id: 'composicao',
  status: 'pending',
  requiresApproval: false,
  organizationId: 'org',
  organization: { id: 'org' },
  payload: JSON.stringify(payload),
  media: null as string | null,
  posts: posts.length ? JSON.stringify(posts) : null,
});

const serviceWith = ({
  repository = {},
  posts = {},
  media = {},
  temporal = {},
}: {
  repository?: Record<string, unknown>;
  posts?: Record<string, unknown>;
  media?: Record<string, unknown>;
  temporal?: Record<string, unknown>;
}) =>
  new CompositionService(
    repository as unknown as CompositionRepository,
    {} as unknown as IntegrationService,
    posts as unknown as PostsService,
    media as unknown as MediaService,
    {} as unknown as SubscriptionService,
    { client: temporal } as unknown as TemporalService,
    {} as unknown as IntegrationManager
  );

describe('CompositionService', () => {
  it.each([
    ['square', false],
    ['portrait', true],
    ['story', true],
  ])('gera o fundo por IA no formato %s com vertical %s', async (size, vertical) => {
    const background = (
      await sharp({
        create: { width: 4, height: 4, channels: 3, background: '#6D4AFF' },
      })
        .png()
        .toBuffer()
    ).toString('base64');
    const generateImage = jest.fn().mockResolvedValue(background);
    const service = serviceWith({
      repository: {
        getCompositionById: jest.fn().mockResolvedValue(
          storedComposition({
            format: 'image',
            size,
            slides: [{ headline: 'Título', background: { type: 'ai', prompt: 'um céu roxo' } }],
            targets: [{ integrationId: 'canal', content: 'Legenda' }],
          })
        ),
        claimRendering: jest.fn().mockResolvedValue({ count: 1 }),
        saveMedia: jest.fn().mockResolvedValue({ count: 1 }),
      },
      media: {
        generateImage,
        saveFile: jest.fn().mockResolvedValue({ id: 'midia', path: '/uploads/slide.png' }),
      },
    });

    await service.renderMedia(`composicao-${size}`);

    expect(generateImage).toHaveBeenCalledWith('um céu roxo', { id: 'org' }, false, vertical);
  }, 60000);

  describe('enfileiramento de um fio', () => {
    const thread = [{ id: 'raiz' }, { id: 'resposta-1' }, { id: 'resposta-2' }];

    const queueing = (workflowStarted: boolean) => {
      const calls: string[] = [];
      const service = serviceWith({
        repository: {
          getCompositionById: jest.fn().mockResolvedValue(
            storedComposition(
              { format: 'text', targets: [{ integrationId: 'canal', content: 'Fio' }] },
              [{ postId: 'raiz', integration: 'canal', target: 0 }]
            )
          ),
          claimQueueing: jest.fn().mockResolvedValue({ count: 1 }),
          holdQueueing: jest.fn().mockResolvedValue({ count: 1 }),
          finishQueueing: jest.fn().mockResolvedValue({ count: 1 }),
        },
        posts: {
          getPostById: jest.fn().mockResolvedValue({ id: 'raiz', state: 'DRAFT', deletedAt: null }),
          getPostsRecursively: jest.fn().mockResolvedValue(thread),
          changePostStatus: jest.fn(async (_org: string, id: string) => {
            calls.push(`workflow ${id}`);
          }),
          changeState: jest.fn(async (id: string, state: string) => {
            calls.push(`${id} ${state}`);
          }),
        },
        temporal: {
          getWorkflowHandle: jest.fn().mockResolvedValue({
            describe: jest
              .fn()
              .mockResolvedValue({ status: { name: workflowStarted ? 'RUNNING' : 'FAILED' } }),
          }),
        },
      });
      return { service, calls };
    };

    it('coloca as respostas na fila antes de iniciar a publicação da raiz', async () => {
      const { service, calls } = queueing(true);

      await service.schedule('composicao');

      expect(calls).toEqual(['resposta-1 QUEUE', 'resposta-2 QUEUE', 'workflow raiz']);
    });

    it('devolve a raiz e as respostas a rascunho quando a publicação não começou', async () => {
      const { service, calls } = queueing(false);

      await expect(service.schedule('composicao')).rejects.toThrow('canal');

      expect(calls.slice(3)).toEqual(['raiz DRAFT', 'resposta-1 DRAFT', 'resposta-2 DRAFT']);
    });
  });
});
