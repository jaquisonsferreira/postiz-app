import { HttpException } from '@nestjs/common';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { AdsService } from '@gitroom/nestjs-libraries/database/prisma/ads/ads.service';
import { AdsRepository } from '@gitroom/nestjs-libraries/database/prisma/ads/ads.repository';
import { AdsManager } from '@gitroom/nestjs-libraries/integrations/ads/ads.manager';
import { AdsProvider } from '@gitroom/nestjs-libraries/integrations/ads/ads.interface';
import { AdsReconnectRequiredError } from '@gitroom/nestjs-libraries/integrations/ads/ads.errors';

process.env.JWT_SECRET = 'segredo-de-teste';

const fakeProvider = (overrides: Partial<AdsProvider> = {}): AdsProvider => ({
  identifier: 'meta-ads',
  name: 'Meta Ads',
  isConfigured: () => true,
  generateAuthUrl: async () => ({ url: 'https://meta.example/oauth', state: 'estado' }),
  authenticate: async () => ({ accessToken: 'acesso', refreshToken: 'renovacao', expiresIn: 3600 }),
  refreshToken: async () => ({ accessToken: 'novo-acesso', refreshToken: 'renovacao', expiresIn: 3600 }),
  listAdAccounts: async () => [
    { externalId: '111', name: 'Loja', currency: 'BRL', timezone: 'America/Sao_Paulo' },
    { externalId: '222', name: 'Clínica', currency: 'USD', timezone: 'America/New_York' },
  ],
  listCampaigns: async () => [
    { externalId: 'c1', name: 'Black Friday', status: 'active', objective: 'OUTCOME_SALES', budgetType: 'daily', budgetAmount: 5000 },
  ],
  dailyMetrics: async () => [
    { campaignExternalId: 'c1', campaignName: 'Black Friday', date: '2026-10-16', impressions: 100, reach: 90, clicks: 4, spend: 1234, conversions: 1 },
    { campaignExternalId: 'c9', campaignName: 'Apagada', date: '2026-10-16', impressions: 10, reach: 9, clicks: 1, spend: 100, conversions: 0 },
  ],
  ...overrides,
});

const serviceWith = (
  repository: Record<string, unknown>,
  provider: AdsProvider = fakeProvider()
) =>
  new AdsService(
    repository as unknown as AdsRepository,
    {
      getProvider: (identifier: string) =>
        identifier === provider.identifier ? provider : undefined,
      getAllProviders: () => [],
    } as unknown as AdsManager
  );

const storedAccount = (overrides: Record<string, unknown> = {}) => ({
  id: 'conta',
  organizationId: 'org',
  provider: 'meta-ads',
  externalId: '111',
  loginCustomerId: null,
  currency: 'BRL',
  token: AuthService.fixedEncryption('acesso'),
  refreshToken: AuthService.fixedEncryption('renovacao'),
  tokenExpiration: new Date('2026-12-01T00:00:00Z'),
  lastSyncAt: null,
  ...overrides,
});

describe('AdsService', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(new Date('2026-10-17T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('connecting', () => {
    it('remembers which organization started the login', async () => {
      const service = serviceWith({});

      const { url } = await service.generateAuthUrl('org', 'meta-ads');

      expect(url).toBe('https://meta.example/oauth');
      expect(await ioRedis.get('ads:organization:estado')).toBe('org');
    });

    it('refuses a provider that does not exist', async () => {
      const service = serviceWith({});

      await expect(service.generateAuthUrl('org', 'tiktok-ads')).rejects.toBeInstanceOf(
        HttpException
      );
    });

    it('refuses a login started by another organization', async () => {
      const service = serviceWith({});
      await service.generateAuthUrl('outra-org', 'meta-ads');

      await expect(
        service.connect('org', 'meta-ads', { code: 'codigo', state: 'estado' })
      ).rejects.toBeInstanceOf(HttpException);
    });

    it('returns the ad accounts to choose from without exposing the token', async () => {
      const service = serviceWith({});
      await service.generateAuthUrl('org', 'meta-ads');

      const result = await service.connect('org', 'meta-ads', {
        code: 'codigo',
        state: 'estado',
      });

      expect(result.accounts.map((account) => account.externalId)).toEqual(['111', '222']);
      expect(JSON.stringify(result)).not.toContain('acesso');
      expect(await ioRedis.get('ads:organization:estado')).toBeUndefined();
    });

    it('saves only the chosen accounts with the tokens encrypted and syncs them', async () => {
      const saved: Record<string, unknown>[] = [];
      const repository = {
        upsertAccount: jest.fn(async (org: string, data: Record<string, unknown>) => {
          saved.push(data);
          return storedAccount({ id: `conta-${data.externalId}`, externalId: data.externalId });
        }),
        upsertCampaign: jest.fn(async (_: string, campaign: { externalId: string }) => ({
          id: `campanha-${campaign.externalId}`,
          externalId: campaign.externalId,
        })),
        upsertMetric: jest.fn(),
        markSynced: jest.fn(),
        listAccounts: jest.fn(async () => [{ id: 'conta-222' }]),
      };
      const service = serviceWith(repository);
      await service.generateAuthUrl('org', 'meta-ads');
      const { connection } = await service.connect('org', 'meta-ads', {
        code: 'codigo',
        state: 'estado',
      });

      const accounts = await service.saveAccounts('org', connection, ['222']);

      expect(accounts).toEqual([{ id: 'conta-222' }]);
      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({
        provider: 'meta-ads',
        externalId: '222',
        name: 'Clínica',
        currency: 'USD',
        timezone: 'America/New_York',
      });
      expect(saved[0].token).not.toBe('acesso');
      expect(AuthService.fixedDecryption(String(saved[0].token))).toBe('acesso');
      expect(AuthService.fixedDecryption(String(saved[0].refreshToken))).toBe('renovacao');
      expect(repository.markSynced).toHaveBeenCalledWith('conta-222');
    });

    it('refuses a connection that expired or belongs to another organization', async () => {
      const service = serviceWith({});

      await expect(service.saveAccounts('org', 'inexistente', ['111'])).rejects.toBeInstanceOf(
        HttpException
      );
    });
  });

  describe('syncing', () => {
    const syncRepository = (account = storedAccount()) => ({
      getAccount: jest.fn(async () => account),
      updateTokens: jest.fn(),
      markRefreshNeeded: jest.fn(),
      markSynced: jest.fn(),
      upsertCampaign: jest.fn(async (_: string, campaign: { externalId: string }) => ({
        id: `campanha-${campaign.externalId}`,
        externalId: campaign.externalId,
      })),
      upsertMetric: jest.fn(),
    });

    it('reads the last 90 days on the first sync, the longest period the screen offers, and keeps every campaign that spent', async () => {
      const dailyMetrics = jest.fn(fakeProvider().dailyMetrics);
      const repository = syncRepository();
      const service = serviceWith(repository, fakeProvider({ dailyMetrics }));

      await service.syncAccount('org', 'conta');

      expect(dailyMetrics).toHaveBeenCalledWith(
        'acesso',
        { externalId: '111', currency: 'BRL', loginCustomerId: null },
        { from: '2026-07-19', to: '2026-10-17' }
      );
      expect(repository.upsertCampaign).toHaveBeenCalledWith('conta', {
        externalId: 'c1',
        name: 'Black Friday',
        status: 'active',
        objective: 'OUTCOME_SALES',
        budgetType: 'daily',
        budgetAmount: 5000,
      });
      expect(repository.upsertCampaign).toHaveBeenCalledWith('conta', {
        externalId: 'c9',
        name: 'Apagada',
        status: 'removed',
        objective: '',
        budgetType: null,
        budgetAmount: null,
      });
      expect(repository.upsertMetric).toHaveBeenCalledWith('campanha-c1', {
        date: '2026-10-16',
        impressions: 100,
        reach: 90,
        clicks: 4,
        spend: 1234,
        conversions: 1,
      });
      expect(repository.upsertMetric).toHaveBeenCalledWith('campanha-c9', {
        date: '2026-10-16',
        impressions: 10,
        reach: 9,
        clicks: 1,
        spend: 100,
        conversions: 0,
      });
      expect(repository.markSynced).toHaveBeenCalledWith('conta');
    });

    it('reads only the last 3 days after the first sync, the platforms still adjust them', async () => {
      const dailyMetrics = jest.fn(async () => []);
      const service = serviceWith(
        syncRepository(storedAccount({ lastSyncAt: new Date('2026-10-17T11:00:00Z') })),
        fakeProvider({ dailyMetrics })
      );

      await service.syncAccount('org', 'conta');

      expect(dailyMetrics).toHaveBeenCalledWith(
        'acesso',
        expect.anything(),
        { from: '2026-10-14', to: '2026-10-17' }
      );
    });

    it('renews an expired token before reading', async () => {
      const listCampaigns = jest.fn(async () => []);
      const repository = syncRepository(
        storedAccount({ tokenExpiration: new Date('2026-10-17T11:00:00Z') })
      );
      const service = serviceWith(
        repository,
        fakeProvider({ listCampaigns, dailyMetrics: async () => [] })
      );

      await service.syncAccount('org', 'conta');

      expect(listCampaigns).toHaveBeenCalledWith('novo-acesso', expect.anything());
      const [id, tokens] = repository.updateTokens.mock.calls[0] as [
        string,
        { token: string; refreshToken: string; tokenExpiration: Date }
      ];
      expect(id).toBe('conta');
      expect(AuthService.fixedDecryption(tokens.token)).toBe('novo-acesso');
      expect(tokens.tokenExpiration).toEqual(new Date('2026-10-17T13:00:00Z'));
    });

    it('marks the account to be connected again when the platform refuses the login', async () => {
      const repository = syncRepository();
      const service = serviceWith(
        repository,
        fakeProvider({
          listCampaigns: async () => {
            throw new AdsReconnectRequiredError();
          },
        })
      );

      await expect(service.syncAccount('org', 'conta')).rejects.toBeInstanceOf(HttpException);
      expect(repository.markRefreshNeeded).toHaveBeenCalledWith('conta');
      expect(repository.markSynced).not.toHaveBeenCalled();
    });

    it('refuses to sync an account of another organization', async () => {
      const repository = { getAccount: jest.fn(async () => null) };
      const service = serviceWith(repository);

      await expect(service.syncAccount('org', 'conta')).rejects.toBeInstanceOf(HttpException);
    });

    it('keeps syncing the other accounts when one fails', async () => {
      const repository = {
        ...syncRepository(),
        accountsToSync: jest.fn(async () => [
          storedAccount({ id: 'quebrada' }),
          storedAccount({ id: 'boa' }),
        ]),
      };
      let calls = 0;
      const service = serviceWith(
        repository,
        fakeProvider({
          listCampaigns: async () => {
            calls += 1;
            if (calls === 1) {
              throw new Error('Meta fora do ar');
            }
            return [];
          },
          dailyMetrics: async () => [],
        })
      );
      jest.spyOn(console, 'error').mockImplementation(() => undefined);

      const result = await service.syncAll();

      expect(result).toEqual({ synced: 1, failed: 1 });
      expect(repository.markSynced).toHaveBeenCalledWith('boa');
    });
  });

  describe('summary', () => {
    it('adds up the period per currency, per day and per campaign', async () => {
      const repository = {
        campaignsWithMetrics: jest.fn(async () => [
          {
            id: 'c1',
            name: 'Black Friday',
            status: 'active',
            budgetType: 'daily',
            budgetAmount: 5000,
            adAccount: { id: 'a1', provider: 'meta-ads', name: 'Loja', currency: 'BRL' },
            metrics: [
              { date: new Date('2026-10-15T00:00:00Z'), impressions: 1000, clicks: 20, spend: 2000, conversions: 2 },
              { date: new Date('2026-10-16T00:00:00Z'), impressions: 1000, clicks: 30, spend: 3000, conversions: 1 },
            ],
          },
          {
            id: 'c2',
            name: 'Pesquisa',
            status: 'paused',
            budgetType: null,
            budgetAmount: null,
            adAccount: { id: 'a2', provider: 'google-ads', name: 'Loja', currency: 'BRL' },
            metrics: [
              { date: new Date('2026-10-16T00:00:00Z'), impressions: 500, clicks: 50, spend: 10000, conversions: 0 },
            ],
          },
          {
            id: 'c3',
            name: 'Nova York',
            status: 'active',
            budgetType: 'daily',
            budgetAmount: 1000,
            adAccount: { id: 'a3', provider: 'meta-ads', name: 'Clínica', currency: 'USD' },
            metrics: [],
          },
          {
            id: 'c4',
            name: 'Parada sem gasto',
            status: 'paused',
            budgetType: null,
            budgetAmount: null,
            adAccount: { id: 'a3', provider: 'meta-ads', name: 'Clínica', currency: 'USD' },
            metrics: [],
          },
        ]),
      };
      const service = serviceWith(repository);

      const summary = await service.summary('org', {
        from: '2026-10-01',
        to: '2026-10-17',
      });

      expect(repository.campaignsWithMetrics).toHaveBeenCalledWith(
        'org',
        new Date('2026-10-01T00:00:00Z'),
        new Date('2026-10-17T00:00:00Z')
      );
      expect(summary.totals).toEqual([
        { currency: 'BRL', spend: 15000, impressions: 2500, clicks: 100, conversions: 3 },
        { currency: 'USD', spend: 0, impressions: 0, clicks: 0, conversions: 0 },
      ]);
      expect(summary.daily).toEqual([
        { date: '2026-10-15', currency: 'BRL', spend: 2000, impressions: 1000, clicks: 20 },
        { date: '2026-10-16', currency: 'BRL', spend: 13000, impressions: 1500, clicks: 80 },
      ]);
      expect(summary.campaigns).toEqual([
        { id: 'c2', name: 'Pesquisa', status: 'paused', provider: 'google-ads', accountName: 'Loja', currency: 'BRL', budgetType: null, budgetAmount: null, spend: 10000, impressions: 500, clicks: 50, conversions: 0 },
        { id: 'c1', name: 'Black Friday', status: 'active', provider: 'meta-ads', accountName: 'Loja', currency: 'BRL', budgetType: 'daily', budgetAmount: 5000, spend: 5000, impressions: 2000, clicks: 50, conversions: 3 },
        { id: 'c3', name: 'Nova York', status: 'active', provider: 'meta-ads', accountName: 'Clínica', currency: 'USD', budgetType: 'daily', budgetAmount: 1000, spend: 0, impressions: 0, clicks: 0, conversions: 0 },
      ]);
    });
  });
});
