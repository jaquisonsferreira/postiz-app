import { HttpException } from '@nestjs/common';
import { TemporalService } from 'nestjs-temporal-core';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { AdsBoostService } from '@gitroom/nestjs-libraries/database/prisma/ads/ads.boost.service';
import { AdsBoostRepository } from '@gitroom/nestjs-libraries/database/prisma/ads/ads.boost.repository';
import { AdsRepository } from '@gitroom/nestjs-libraries/database/prisma/ads/ads.repository';
import { AdsService } from '@gitroom/nestjs-libraries/database/prisma/ads/ads.service';
import { AdsManager } from '@gitroom/nestjs-libraries/integrations/ads/ads.manager';
import { AdsProvider } from '@gitroom/nestjs-libraries/integrations/ads/ads.interface';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';

// The integration manager loads ESM-only packages that Jest can't require, each
// test passes the stub of the calls it expects
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class IntegrationManager {},
}));

process.env.JWT_SECRET = 'segredo-de-teste';

const account = {
  id: 'conta',
  organizationId: 'org',
  name: 'Loja',
  provider: 'meta-ads',
  externalId: '111',
  loginCustomerId: null,
  currency: 'BRL',
  token: AuthService.fixedEncryption('acesso'),
  refreshToken: '',
  tokenExpiration: null,
  lastSyncAt: null,
};

const publishedPost = (overrides: Record<string, unknown> = {}) => ({
  id: 'post',
  content: '<p>Lançamento da coleção de verão com <b>desconto</b> para toda a loja</p>',
  state: 'PUBLISHED',
  releaseId: '900_800',
  integration: {
    id: 'canal',
    providerIdentifier: 'facebook',
    token: 'token-da-pagina',
    internalId: '900',
    picture: null,
  },
  ...overrides,
});

const metaProvider = (overrides: Partial<AdsProvider> = {}) =>
  ({
    identifier: 'meta-ads',
    name: 'Meta Ads',
    boost: {
      promotes: ['meta-post'],
      objectives: ['engagement', 'reach'],
      budgetTypes: ['daily', 'lifetime'],
      needsDestinationUrl: false,
      needsTexts: false,
    },
    boostPost: jest.fn(async () => ({ campaignId: 'c1', adSetId: 's1', creativeId: 'cr1', adId: 'a1' })),
    setCampaignStatus: jest.fn(async () => undefined),
    ...overrides,
  }) as unknown as AdsProvider;

const request = {
  postId: 'post',
  adAccountId: 'conta',
  objective: 'engagement' as const,
  budgetType: 'daily' as const,
  budgetAmount: 2000,
  days: 7,
  audience: { countries: ['BR'], ageMin: 18, ageMax: 65 },
};

const setup = ({
  post = publishedPost(),
  rule = null as Record<string, unknown> | null,
  provider = metaProvider(),
  boosts = {} as Record<string, unknown>,
  start = jest.fn(async () => ({})),
  temporal = true,
} = {}) => {
  const boostRepository = {
    getPublishedPost: jest.fn(async () => post),
    createBoost: jest.fn(async (data: Record<string, unknown>) => ({ id: 'impulso', ...data })),
    getBoost: jest.fn(),
    claimBoost: jest.fn(async () => 1),
    updateBoost: jest.fn(async (id: string, data: Record<string, unknown>) => ({ id, ...data })),
    getBoostToLaunch: jest.fn(),
    autoBoostRules: jest.fn(async () => []),
    postsToAutoBoost: jest.fn(async () => []),
    ...boosts,
  };
  const adsRepository = {
    getAccount: jest.fn(async (org: string) => (org === 'org' ? account : null)),
    getRule: jest.fn(async () => rule),
    upsertCampaign: jest.fn(async () => ({ id: 'campanha', externalId: 'c1' })),
  };
  const adsService = {
    onPlatform: jest.fn(async (_: unknown, run: (p: AdsProvider, token: string) => Promise<unknown>) =>
      run(provider, 'acesso')
    ),
  };
  const promotableReference = jest.fn(async () => ({ type: 'meta-post', id: '900_800' }));
  const service = new AdsBoostService(
    boostRepository as unknown as AdsBoostRepository,
    adsRepository as unknown as AdsRepository,
    adsService as unknown as AdsService,
    { getProvider: () => provider } as unknown as AdsManager,
    {
      getSocialIntegration: (identifier: string) =>
        identifier === 'facebook' ? { promotableReference } : {},
    } as unknown as IntegrationManager,
    {
      client: { getRawClient: () => (temporal ? { workflow: { start } } : undefined) },
    } as unknown as TemporalService
  );
  return { service, boostRepository, adsRepository, adsService, provider, start, promotableReference };
};

describe('AdsBoostService', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(new Date('2026-10-18T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('options', () => {
    it('lists the ad accounts able to promote the published post', async () => {
      const { service, boostRepository } = setup({
        boosts: {
          accountsOf: jest.fn(async () => [
            { id: 'conta', name: 'Loja', provider: 'meta-ads', currency: 'BRL' },
            { id: 'google', name: 'Clínica', provider: 'google-ads', currency: 'BRL' },
          ]),
        },
      });

      const options = await service.options('org', 'post');

      expect(boostRepository.getPublishedPost).toHaveBeenCalledWith('org', 'post');
      expect(options.accounts).toEqual([
        {
          id: 'conta',
          name: 'Loja',
          provider: 'meta-ads',
          currency: 'BRL',
          capabilities: {
            promotes: ['meta-post'],
            objectives: ['engagement', 'reach'],
            budgetTypes: ['daily', 'lifetime'],
            needsDestinationUrl: false,
            needsTexts: false,
          },
        },
        {
          id: 'google',
          name: 'Clínica',
          provider: 'google-ads',
          currency: 'BRL',
          capabilities: {
            promotes: ['meta-post'],
            objectives: ['engagement', 'reach'],
            budgetTypes: ['daily', 'lifetime'],
            needsDestinationUrl: false,
            needsTexts: false,
          },
        },
      ]);
    });

    it('refuses posts not published yet and channels without promotion', async () => {
      await expect(setup({ post: null as never }).service.options('org', 'post')).rejects.toEqual(
        new HttpException('Post not found', 404)
      );
      await expect(
        setup({ post: publishedPost({ state: 'QUEUE', releaseId: null }) }).service.options('org', 'post')
      ).rejects.toEqual(new HttpException('Only published posts can be promoted', 400));
      await expect(
        setup({
          post: publishedPost({ integration: { ...publishedPost().integration, providerIdentifier: 'x' } }),
        }).service.options('org', 'post')
      ).rejects.toEqual(new HttpException('Posts of this channel cannot be promoted', 400));
    });
  });

  describe('creating', () => {
    it('launches at once when no rule asks for approval', async () => {
      const { service, boostRepository, start } = setup();

      const boost = await service.create('org', request, 'manual');

      expect(boostRepository.createBoost).toHaveBeenCalledWith({
        organizationId: 'org',
        adAccountId: 'conta',
        postId: 'post',
        origin: 'manual',
        status: 'launching',
        name: 'Pauta: Lançamento da coleção de verão com desconto para…',
        reference: JSON.stringify({ type: 'meta-post', id: '900_800' }),
        objective: 'engagement',
        budgetType: 'daily',
        budgetAmount: 2000,
        days: 7,
        audience: JSON.stringify(request.audience),
        destinationUrl: null,
        texts: null,
      });
      expect(start).toHaveBeenCalledWith(
        'adBoostWorkflow',
        expect.objectContaining({
          workflowId: 'ad-boost-impulso',
          taskQueue: 'main',
          args: [{ boostId: 'impulso' }],
        })
      );
      expect(boost.status).toBe('launching');
    });

    it('waits for approval above the threshold of the account, counting every day', async () => {
      const { service, boostRepository, start } = setup({
        rule: { approvalThreshold: 10000, cappedMonth: null },
      });

      await service.create('org', request, 'manual');

      expect(boostRepository.createBoost).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'awaiting_approval' })
      );
      expect(start).not.toHaveBeenCalled();
    });

    it('always waits for approval when the AI agent asks for it', async () => {
      const { service, boostRepository, start } = setup();

      await service.create('org', { ...request, budgetAmount: 100 }, 'agent');

      expect(boostRepository.createBoost).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'awaiting_approval', origin: 'agent' })
      );
      expect(start).not.toHaveBeenCalled();
    });

    it('refuses what the ad account cannot do and a month that reached the cap', async () => {
      const { service } = setup();
      await expect(service.create('org', { ...request, objective: 'traffic' }, 'manual')).rejects.toEqual(
        new HttpException('Meta Ads cannot run this objective', 400)
      );
      await expect(service.create('other', request, 'manual')).rejects.toEqual(
        new HttpException('Ad account not found', 404)
      );

      const needsTexts = setup({
        provider: metaProvider({
          boost: { promotes: ['meta-post'], objectives: ['engagement'], budgetTypes: ['daily'], needsDestinationUrl: true, needsTexts: true },
        }),
      });
      await expect(needsTexts.service.create('org', request, 'manual')).rejects.toEqual(
        new HttpException('Meta Ads needs a landing page and the ad texts', 400)
      );

      const capped = setup({ rule: { approvalThreshold: null, cappedMonth: '2026-10' } });
      await expect(capped.service.create('org', request, 'manual')).rejects.toEqual(
        new HttpException('This ad account reached its monthly budget', 400)
      );
    });

    it('refuses before saving anything when boosting is not reachable', async () => {
      const { service, boostRepository } = setup({ temporal: false });

      await expect(service.create('org', request, 'manual')).rejects.toEqual(
        new HttpException('Boosting is not available right now', 503)
      );
      expect(boostRepository.createBoost).not.toHaveBeenCalled();
    });

    it('refuses a minimum age above the maximum', async () => {
      const { service } = setup();

      await expect(
        service.create(
          'org',
          { ...request, audience: { countries: ['BR'], ageMin: 40, ageMax: 20 } },
          'manual'
        )
      ).rejects.toEqual(new HttpException('The minimum age must not be above the maximum', 400));
    });

    it('marks the boost as failed when the workflow cannot start', async () => {
      const { service, boostRepository } = setup({
        start: jest.fn(async () => {
          throw new Error('Temporal is down');
        }),
      });

      await expect(service.create('org', request, 'manual')).rejects.toEqual(
        new HttpException('Boosting is not available right now', 503)
      );
      expect(boostRepository.updateBoost).toHaveBeenCalledWith('impulso', {
        status: 'failed',
        error: 'Boosting is not available right now',
      });
    });
  });

  describe('approving', () => {
    it('launches an approved boost and keeps a rejected one stopped', async () => {
      const { service, boostRepository, start } = setup();

      await service.approve('org', 'impulso');
      expect(boostRepository.claimBoost).toHaveBeenCalledWith('org', 'impulso', 'launching');
      expect(start).toHaveBeenCalledTimes(1);

      await service.reject('org', 'impulso');
      expect(boostRepository.claimBoost).toHaveBeenCalledWith('org', 'impulso', 'rejected');
      expect(start).toHaveBeenCalledTimes(1);
    });

    it('only decides boosts that wait for approval, once', async () => {
      const { service, start } = setup({
        boosts: {
          claimBoost: jest.fn(async () => 0),
          getBoost: jest.fn(async () => ({ id: 'impulso', status: 'launching' })),
        },
      });

      await expect(service.approve('org', 'impulso')).rejects.toEqual(
        new HttpException('This boost is not waiting for approval', 400)
      );
      expect(start).not.toHaveBeenCalled();
    });

    it('answers not found for a boost of another organization', async () => {
      const { service } = setup({
        boosts: { claimBoost: jest.fn(async () => 0), getBoost: jest.fn(async () => null) },
      });

      await expect(service.reject('org', 'impulso')).rejects.toEqual(
        new HttpException('Boost not found', 404)
      );
    });

    it('keeps the boost launching when its workflow was already started', async () => {
      const already = Object.assign(new Error('Workflow execution already started'), {
        name: 'WorkflowExecutionAlreadyStartedError',
      });
      const { service, boostRepository } = setup({
        start: jest.fn(async () => {
          throw already;
        }),
      });

      await service.approve('org', 'impulso');
      expect(boostRepository.updateBoost).not.toHaveBeenCalled();
    });
  });

  describe('launching', () => {
    const toLaunch = (overrides: Record<string, unknown> = {}) => ({
      id: 'impulso',
      status: 'launching',
      name: 'Pauta: Lançamento',
      reference: JSON.stringify({ type: 'meta-post', id: '900_800' }),
      objective: 'engagement',
      budgetType: 'daily',
      budgetAmount: 2000,
      days: 7,
      audience: JSON.stringify(request.audience),
      destinationUrl: null,
      texts: null,
      startDate: null,
      endDate: null,
      externalCampaignId: null,
      externalAdSetId: null,
      externalCreativeId: null,
      externalAdId: null,
      adAccount: account,
      ...overrides,
    });

    it('creates the ads paused, activates the campaign and keeps it with the other campaigns', async () => {
      const { service, boostRepository, adsRepository, provider } = setup({
        boosts: { getBoostToLaunch: jest.fn(async () => toLaunch()) },
      });

      await service.launch('impulso');

      expect(boostRepository.updateBoost).toHaveBeenCalledWith('impulso', {
        startDate: new Date('2026-10-18T12:00:00Z'),
        endDate: new Date('2026-10-25T12:00:00Z'),
      });
      expect(provider.boostPost).toHaveBeenCalledWith(
        'acesso',
        { externalId: '111', currency: 'BRL', loginCustomerId: null },
        {
          name: 'Pauta: Lançamento',
          reference: { type: 'meta-post', id: '900_800' },
          objective: 'engagement',
          budgetType: 'daily',
          budgetAmount: 2000,
          startDate: new Date('2026-10-18T12:00:00Z'),
          endDate: new Date('2026-10-25T12:00:00Z'),
          audience: request.audience,
          destinationUrl: null,
          texts: null,
        },
        { campaignId: null, adSetId: null, creativeId: null, adId: null },
        expect.any(Function)
      );
      expect(provider.setCampaignStatus).toHaveBeenCalledWith(
        'acesso',
        { externalId: '111', currency: 'BRL', loginCustomerId: null },
        'c1',
        'active'
      );
      expect(adsRepository.upsertCampaign).toHaveBeenCalledWith('conta', {
        externalId: 'c1',
        name: 'Pauta: Lançamento',
        status: 'active',
        objective: 'engagement',
        budgetType: 'daily',
        budgetAmount: 2000,
      });
      expect(boostRepository.updateBoost).toHaveBeenLastCalledWith('impulso', { status: 'active', error: null });
    });

    it('saves every id the platform gives so a retry continues from there', async () => {
      const provider = metaProvider({
        boostPost: jest.fn(async (_t, _a, _i, progress, save) => {
          await save({ ...progress, campaignId: 'c1' });
          throw new Error('Meta is down');
        }) as AdsProvider['boostPost'],
      });
      const { service, boostRepository } = setup({
        provider,
        boosts: {
          getBoostToLaunch: jest.fn(async () =>
            toLaunch({ startDate: new Date('2026-10-17T12:00:00Z'), endDate: new Date('2026-10-24T12:00:00Z') })
          ),
        },
      });

      await expect(service.launch('impulso')).rejects.toThrow('Meta is down');
      expect(boostRepository.updateBoost).toHaveBeenCalledWith('impulso', {
        externalCampaignId: 'c1',
        externalAdSetId: null,
        externalCreativeId: null,
        externalAdId: null,
      });
      expect(boostRepository.updateBoost).not.toHaveBeenCalledWith(
        'impulso',
        expect.objectContaining({ startDate: expect.anything() })
      );
    });

    it('stops when the platform gave no campaign id', async () => {
      const provider = metaProvider({
        boostPost: jest.fn(async () => ({ campaignId: null, adSetId: null, creativeId: null, adId: null })),
      } as Partial<AdsProvider>);
      const { service, adsRepository } = setup({
        provider,
        boosts: { getBoostToLaunch: jest.fn(async () => toLaunch()) },
      });

      await expect(service.launch('impulso')).rejects.toThrow('Meta Ads did not create the campaign');
      expect(provider.setCampaignStatus).not.toHaveBeenCalled();
      expect(adsRepository.upsertCampaign).not.toHaveBeenCalled();
    });

    it('does nothing for a boost that is no longer launching', async () => {
      const { service, provider } = setup({
        boosts: { getBoostToLaunch: jest.fn(async () => toLaunch({ status: 'rejected' })) },
      });

      await service.launch('impulso');

      expect(provider.boostPost).not.toHaveBeenCalled();
    });
  });

  describe('promoting new posts automatically', () => {
    it('creates a boost for each new post of a channel with automatic boosting', async () => {
      const { service, boostRepository } = setup({
        boosts: {
          autoBoostRules: jest.fn(async () => [
            {
              id: 'automatico',
              organizationId: 'org',
              integrationId: 'canal',
              adAccountId: 'conta',
              objective: 'engagement',
              budgetType: 'daily',
              budgetAmount: 2000,
              days: 7,
              audience: JSON.stringify(request.audience),
              destinationUrl: null,
              texts: null,
              createdAt: new Date('2026-10-01T00:00:00Z'),
            },
          ]),
          postsToAutoBoost: jest.fn(async () => [{ id: 'post' }, { id: 'outro' }]),
        },
      });

      expect(await service.autoBoost()).toEqual({ created: 2, failed: 0 });
      expect(boostRepository.postsToAutoBoost).toHaveBeenCalledWith('canal', new Date('2026-10-17T12:00:00Z'));
      expect(boostRepository.createBoost).toHaveBeenCalledWith(
        expect.objectContaining({ origin: 'auto', postId: 'post', status: 'launching' })
      );
    });
  });

  describe('automatic boost limits', () => {
    const autoRule = (createdAt: Date) => ({
      id: 'automatico',
      organizationId: 'org',
      integrationId: 'canal',
      adAccountId: 'conta',
      objective: 'engagement',
      budgetType: 'daily',
      budgetAmount: 2000,
      days: 7,
      audience: JSON.stringify(request.audience),
      destinationUrl: null,
      texts: null,
      createdAt,
    });

    it('only looks at posts published after the rule was turned on', async () => {
      const createdAt = new Date('2026-10-18T09:00:00Z');
      const { service, boostRepository } = setup({
        boosts: { autoBoostRules: jest.fn(async () => [autoRule(createdAt)]) },
      });

      await service.autoBoost();
      expect(boostRepository.postsToAutoBoost).toHaveBeenCalledWith('canal', createdAt);
    });

    it('skips an account that reached its monthly cap', async () => {
      const { service, boostRepository } = setup({
        rule: { approvalThreshold: null, cappedMonth: '2026-10' },
        boosts: {
          autoBoostRules: jest.fn(async () => [autoRule(new Date('2026-10-01T00:00:00Z'))]),
        },
      });

      expect(await service.autoBoost()).toEqual({ created: 0, failed: 0 });
      expect(boostRepository.postsToAutoBoost).not.toHaveBeenCalled();
    });
  });

  describe('saveAutoBoost', () => {
    const rule = { ...request, postId: undefined, integrationId: 'canal' };

    it('saves the automatic boost of a channel whose posts can be promoted', async () => {
      const upsertAutoBoost = jest.fn(async () => ({ id: 'regra' }));
      const { service } = setup({
        boosts: {
          getIntegration: jest.fn(async () => ({ id: 'canal', providerIdentifier: 'facebook' })),
          upsertAutoBoost,
        },
      });

      await service.saveAutoBoost('org', rule);

      expect(upsertAutoBoost).toHaveBeenCalledWith('org', {
        integrationId: 'canal',
        adAccountId: 'conta',
        objective: 'engagement',
        budgetType: 'daily',
        budgetAmount: 2000,
        days: 7,
        audience: JSON.stringify(request.audience),
        destinationUrl: null,
        texts: null,
      });
    });

    it('refuses a channel of another organization', async () => {
      const { service } = setup({ boosts: { getIntegration: jest.fn(async () => null) } });

      await expect(service.saveAutoBoost('org', rule)).rejects.toThrow(
        new HttpException('Channel not found', 404)
      );
    });

    it('refuses a channel whose posts cannot be promoted', async () => {
      const { service } = setup({
        boosts: {
          getIntegration: jest.fn(async () => ({ id: 'canal', providerIdentifier: 'x' })),
        },
      });

      await expect(service.saveAutoBoost('org', rule)).rejects.toThrow(
        new HttpException('Posts of this channel cannot be promoted', 400)
      );
    });
  });
});
