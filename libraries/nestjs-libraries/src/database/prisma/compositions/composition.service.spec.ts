import sharp from 'sharp';
import dayjs from 'dayjs';
import { HttpException } from '@nestjs/common';
import { TemporalService } from 'nestjs-temporal-core';
import { CompositionService } from '@gitroom/nestjs-libraries/database/prisma/compositions/composition.service';
import { CompositionRepository } from '@gitroom/nestjs-libraries/database/prisma/compositions/composition.repository';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { CompositionValidationError } from '@gitroom/nestjs-libraries/compositions/composition.errors';

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
  integrations = {},
  subscriptions = {},
}: {
  repository?: Record<string, unknown>;
  posts?: Record<string, unknown>;
  media?: Record<string, unknown>;
  temporal?: Record<string, unknown>;
  integrations?: Record<string, unknown>;
  subscriptions?: Record<string, unknown>;
}) =>
  new CompositionService(
    repository as unknown as CompositionRepository,
    integrations as unknown as IntegrationService,
    posts as unknown as PostsService,
    media as unknown as MediaService,
    subscriptions as unknown as SubscriptionService,
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

  describe('fundo por IA recusado', () => {
    const rendering = (rejection: HttpException) =>
      serviceWith({
        repository: {
          getCompositionById: jest.fn().mockResolvedValue(
            storedComposition({
              format: 'image',
              slides: [{ headline: 'Título', background: { type: 'ai', prompt: 'um prompt recusado' } }],
              targets: [{ integrationId: 'canal', content: 'Legenda' }],
            })
          ),
          claimRendering: jest.fn().mockResolvedValue({ count: 1 }),
        },
        media: {
          generateImage: jest.fn().mockRejectedValue(rejection),
        },
      });

    it('para a composição com a mensagem do gerador quando ele recusa o prompt', async () => {
      const message =
        'Your request was rejected by the AI safety system. Flagged categories: violence. Please adjust your prompt and try again.';

      const error = await rendering(new HttpException(message, 422))
        .renderMedia('composicao-recusada')
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(CompositionValidationError);
      expect((error as Error).message).toContain(message);
    }, 60000);

    it('deixa uma falha temporária do gerador para a próxima tentativa', async () => {
      const error = await rendering(
        new HttpException('AI generation failed, please try again later.', 500)
      )
        .renderMedia('composicao-falha-temporaria')
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(CompositionValidationError);
    }, 60000);
  });

  describe('limite mensal de posts do plano', () => {
    const env = { ...process.env };
    const periodStart = dayjs().subtract(2, 'month').subtract(3, 'day');
    const thread = [
      { id: 'raiz', integrationId: 'canal', settings: '{}', content: 'Fio', image: '[]', state: 'DRAFT', deletedAt: null },
      { id: 'resposta-1', content: 'Resposta 1', image: '[]', state: 'DRAFT', deletedAt: null },
      { id: 'resposta-2', content: 'Resposta 2', image: '[]', state: 'DRAFT', deletedAt: null },
    ];

    beforeEach(() => {
      process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test';
    });
    afterEach(() => {
      process.env = { ...env };
    });

    const withPlan = (
      subscription: { subscriptionTier: string; createdAt: Date } | null,
      used: number
    ) => {
      const changePostStatus = jest.fn();
      const changeState = jest.fn();
      const countPostsFromDay = jest.fn().mockResolvedValue(used);
      const claimApproval = jest.fn().mockResolvedValue({ count: 1 });
      const service = serviceWith({
        repository: {
          getCompositionById: jest.fn().mockResolvedValue(
            storedComposition(
              { format: 'text', targets: [{ integrationId: 'canal', content: 'Fio' }] },
              [{ postId: 'raiz', integration: 'canal', target: 0 }]
            )
          ),
          getComposition: jest.fn().mockResolvedValue({
            id: 'composicao',
            status: 'awaiting_approval',
            media: null,
            posts: JSON.stringify([{ postId: 'raiz', integration: 'canal', target: 0 }]),
          }),
          claimQueueing: jest.fn().mockResolvedValue({ count: 1 }),
          holdQueueing: jest.fn().mockResolvedValue({ count: 1 }),
          finishQueueing: jest.fn().mockResolvedValue({ count: 1 }),
          claimApproval,
        },
        posts: {
          getPostById: jest.fn().mockResolvedValue({ id: 'raiz', state: 'DRAFT', deletedAt: null }),
          getPostsRecursively: jest.fn().mockResolvedValue(thread),
          validatePosts: jest.fn().mockResolvedValue([]),
          countPostsFromDay,
          changePostStatus,
          changeState,
        },
        integrations: {
          getIntegrationById: jest
            .fn()
            .mockResolvedValue({ id: 'canal', deletedAt: null, disabled: false }),
        },
        subscriptions: {
          getSubscription: jest.fn().mockResolvedValue(subscription),
        },
        temporal: {
          getWorkflowHandle: jest.fn().mockResolvedValue({
            describe: jest.fn().mockResolvedValue({ status: { name: 'RUNNING' } }),
          }),
        },
      });
      return { service, changePostStatus, changeState, countPostsFromDay, claimApproval };
    };

    it('para a composição sem enfileirar quando o fio passa do limite do mês', async () => {
      const { service, changePostStatus, changeState } = withPlan(
        { subscriptionTier: 'STANDARD', createdAt: periodStart.toDate() },
        999998
      );

      const error = await service.schedule('composicao').catch((err: unknown) => err);

      expect(error).toBeInstanceOf(CompositionValidationError);
      expect((error as Error).message).toContain('maximum number of posts');
      expect(changeState).not.toHaveBeenCalled();
      expect(changePostStatus).not.toHaveBeenCalled();
    });

    it('enfileira o fio que cabe no que resta do mês, contado desde o início do período', async () => {
      const { service, changePostStatus, countPostsFromDay } = withPlan(
        { subscriptionTier: 'STANDARD', createdAt: periodStart.toDate() },
        999997
      );

      await service.schedule('composicao');

      expect(countPostsFromDay).toHaveBeenCalledWith('org', periodStart.add(2, 'month').toDate());
      expect(changePostStatus).toHaveBeenCalledWith('org', 'raiz', 'schedule');
    });

    it('não enfileira posts de uma organização sem assinatura', async () => {
      const { service, changePostStatus } = withPlan(null, 0);

      await expect(service.schedule('composicao')).rejects.toBeInstanceOf(
        CompositionValidationError
      );
      expect(changePostStatus).not.toHaveBeenCalled();
    });

    it('recusa a aprovação que passaria do limite do mês antes de reservá-la', async () => {
      const { service, claimApproval, changePostStatus } = withPlan(
        { subscriptionTier: 'STANDARD', createdAt: periodStart.toDate() },
        999998
      );

      const error = await service
        .approveComposition('org', 'composicao')
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(402);
      expect(claimApproval).not.toHaveBeenCalled();
      expect(changePostStatus).not.toHaveBeenCalled();
    });

    it('não conta posts quando a cobrança está desligada', async () => {
      delete process.env.STRIPE_PUBLISHABLE_KEY;
      const { service, changePostStatus, countPostsFromDay } = withPlan(null, 0);

      await service.schedule('composicao');

      expect(countPostsFromDay).not.toHaveBeenCalled();
      expect(changePostStatus).toHaveBeenCalled();
    });
  });

  describe('post já na fila de uma tentativa que parou', () => {
    const queued = (workflow: 'RUNNING' | 'missing') => {
      const calls: string[] = [];
      const finishQueueing = jest.fn().mockResolvedValue({ count: 1 });
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
          finishQueueing,
        },
        posts: {
          getPostById: jest.fn().mockResolvedValue({ id: 'raiz', state: 'QUEUE', deletedAt: null }),
          getPostsRecursively: jest
            .fn()
            .mockResolvedValue([{ id: 'raiz' }, { id: 'resposta-1' }]),
          changePostStatus: jest.fn(async (_org: string, id: string) => {
            calls.push(`workflow ${id}`);
          }),
          changeState: jest.fn(async (id: string, state: string) => {
            calls.push(`${id} ${state}`);
          }),
        },
        temporal: {
          getWorkflowHandle:
            workflow === 'RUNNING'
              ? jest.fn().mockResolvedValue({
                  describe: jest.fn().mockResolvedValue({ status: { name: 'RUNNING' } }),
                })
              : jest.fn().mockRejectedValue(new Error('workflow not found')),
        },
      });
      return { service, calls, finishQueueing };
    };

    it('devolve a rascunho o post na fila cuja publicação nunca começou, para a próxima tentativa iniciá-la', async () => {
      const { service, calls, finishQueueing } = queued('missing');

      await expect(service.schedule('composicao')).rejects.toThrow('canal');

      expect(calls).toEqual(['raiz DRAFT', 'resposta-1 DRAFT']);
      expect(finishQueueing).not.toHaveBeenCalled();
    });

    it('mantém o post na fila cuja publicação já começou', async () => {
      const { service, calls, finishQueueing } = queued('RUNNING');

      await service.schedule('composicao');

      expect(calls).toEqual([]);
      expect(finishQueueing).toHaveBeenCalled();
    });
  });

  describe('criação dos rascunhos de um canal', () => {
    const creating = ({ saved, current }: { saved: boolean; current: unknown }) => {
      const calls: string[] = [];
      const stored = storedComposition({
        format: 'text',
        requiresApproval: true,
        targets: [{ integrationId: 'canal', content: 'Legenda' }],
      });
      const service = serviceWith({
        repository: {
          getCompositionById: jest
            .fn()
            .mockResolvedValueOnce({ ...stored, requiresApproval: true })
            .mockResolvedValue(current),
          claimScheduling: jest.fn().mockResolvedValue({ count: 1 }),
          holdScheduling: jest.fn().mockResolvedValue({ count: 1 }),
          savePosts: jest.fn().mockResolvedValue({ count: saved ? 1 : 0 }),
          claimQueueing: jest.fn().mockResolvedValue({ count: 1 }),
          finishQueueing: jest.fn().mockResolvedValue({ count: 1 }),
        },
        posts: {
          mapTypeToPost: jest.fn(async (body: unknown) => body),
          validatePosts: jest.fn().mockResolvedValue([]),
          deletePost: jest.fn(async (_org: string, group: string) => {
            calls.push(`delete ${group}`);
          }),
          createPost: jest.fn(async () => {
            calls.push('create');
            return [{ postId: 'composicao-0-0', integration: 'canal' }];
          }),
        },
        integrations: {
          getIntegrationById: jest.fn().mockResolvedValue({
            id: 'canal',
            providerIdentifier: 'x',
            deletedAt: null,
            disabled: false,
          }),
        },
      });
      return { service, calls };
    };

    it('não apaga o grupo do canal antes de recriar os posts, que voltam com os mesmos ids', async () => {
      const { service, calls } = creating({ saved: true, current: null });

      await service.schedule('composicao');

      expect(calls).toEqual(['create']);
    });

    it('remove o rascunho criado depois que a composição foi excluída', async () => {
      const { service, calls } = creating({ saved: false, current: null });

      await expect(service.schedule('composicao')).rejects.toThrow();

      expect(calls).toEqual(['create', 'delete composicao-0']);
    });

    it('remove o rascunho criado depois que a composição falhou', async () => {
      const { service, calls } = creating({
        saved: false,
        current: { id: 'composicao', status: 'failed' },
      });

      await expect(service.schedule('composicao')).rejects.toThrow();

      expect(calls).toEqual(['create', 'delete composicao-0']);
    });

    it('deixa o rascunho para a tentativa que assumiu a reserva', async () => {
      const { service, calls } = creating({
        saved: false,
        current: { id: 'composicao', status: 'scheduling' },
      });

      await expect(service.schedule('composicao')).rejects.toThrow('another attempt');

      expect(calls).toEqual(['create']);
    });
  });
});
