import { MetaAdsProvider } from '@gitroom/nestjs-libraries/integrations/ads/meta.ads.provider';
import {
  AdsApiError,
  AdsReconnectRequiredError,
} from '@gitroom/nestjs-libraries/integrations/ads/ads.errors';

const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const fetchReturning = (...bodies: unknown[]) => {
  const spy = jest.spyOn(global, 'fetch');
  for (const body of bodies) {
    spy.mockResolvedValueOnce(respond(body));
  }
  return spy;
};

const requestedUrl = (spy: jest.SpyInstance, call: number) =>
  new URL(String(spy.mock.calls[call][0]));

describe('MetaAdsProvider', () => {
  const provider = new MetaAdsProvider();

  beforeEach(() => {
    process.env.FACEBOOK_APP_ID = 'app-id';
    process.env.FACEBOOK_APP_SECRET = 'app-secret';
    process.env.FRONTEND_URL = 'https://pauta.example';
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('is available only when the Meta app is configured', () => {
    expect(provider.isConfigured()).toBe(true);
    delete process.env.FACEBOOK_APP_SECRET;
    expect(provider.isConfigured()).toBe(false);
  });

  it('asks only for the ads read scopes and returns to the ads callback', async () => {
    const { url, state } = await provider.generateAuthUrl();
    const parsed = new URL(url);

    expect(parsed.origin + parsed.pathname).toBe(
      'https://www.facebook.com/v25.0/dialog/oauth'
    );
    expect(parsed.searchParams.get('client_id')).toBe('app-id');
    expect(parsed.searchParams.get('scope')).toBe('ads_read,business_management');
    expect(parsed.searchParams.get('redirect_uri')).toBe(
      'https://pauta.example/ads/connect/meta-ads'
    );
    expect(parsed.searchParams.get('state')).toBe(state);
    expect(state.length).toBeGreaterThan(5);
  });

  it('exchanges the code for a long lived token', async () => {
    const spy = fetchReturning(
      { access_token: 'short' },
      { access_token: 'long', expires_in: 5183944 }
    );

    const tokens = await provider.authenticate('the-code');

    expect(requestedUrl(spy, 0).searchParams.get('code')).toBe('the-code');
    expect(requestedUrl(spy, 0).searchParams.get('redirect_uri')).toBe(
      'https://pauta.example/ads/connect/meta-ads'
    );
    expect(requestedUrl(spy, 1).searchParams.get('grant_type')).toBe(
      'fb_exchange_token'
    );
    expect(requestedUrl(spy, 1).searchParams.get('fb_exchange_token')).toBe('short');
    expect(tokens).toEqual({
      accessToken: 'long',
      refreshToken: '',
      expiresIn: 5183944,
    });
  });

  it('asks for a new login when the token expires, Meta has no refresh token', async () => {
    await expect(provider.refreshToken('')).rejects.toBeInstanceOf(
      AdsReconnectRequiredError
    );
  });

  it('lists every ad account across pages', async () => {
    const spy = fetchReturning(
      {
        data: [
          { account_id: '111', name: 'Loja', currency: 'BRL', timezone_name: 'America/Sao_Paulo' },
        ],
        paging: { next: 'https://graph.facebook.com/v25.0/me/adaccounts?after=abc' },
      },
      {
        data: [
          { account_id: '222', name: 'Clínica', currency: 'USD', timezone_name: 'America/New_York' },
        ],
      }
    );

    const accounts = await provider.listAdAccounts('token');

    expect(requestedUrl(spy, 0).pathname).toBe('/v25.0/me/adaccounts');
    expect(requestedUrl(spy, 1).searchParams.get('after')).toBe('abc');
    expect(accounts).toEqual([
      { externalId: '111', name: 'Loja', currency: 'BRL', timezone: 'America/Sao_Paulo' },
      { externalId: '222', name: 'Clínica', currency: 'USD', timezone: 'America/New_York' },
    ]);
  });

  it('maps campaigns with their status and budget in cents', async () => {
    const spy = fetchReturning({
      data: [
        { id: 'c1', name: 'Black Friday', status: 'ACTIVE', objective: 'OUTCOME_SALES', daily_budget: '5000' },
        { id: 'c2', name: 'Lançamento', status: 'PAUSED', objective: 'OUTCOME_AWARENESS', lifetime_budget: '120000' },
        { id: 'c3', name: 'Antiga', status: 'ARCHIVED', objective: 'OUTCOME_TRAFFIC' },
      ],
    });

    const campaigns = await provider.listCampaigns('token', {
      externalId: '111',
      currency: 'BRL',
    });

    expect(requestedUrl(spy, 0).pathname).toBe('/v25.0/act_111/campaigns');
    expect(campaigns).toEqual([
      { externalId: 'c1', name: 'Black Friday', status: 'active', objective: 'OUTCOME_SALES', budgetType: 'daily', budgetAmount: 5000 },
      { externalId: 'c2', name: 'Lançamento', status: 'paused', objective: 'OUTCOME_AWARENESS', budgetType: 'lifetime', budgetAmount: 120000 },
      { externalId: 'c3', name: 'Antiga', status: 'removed', objective: 'OUTCOME_TRAFFIC', budgetType: null, budgetAmount: null },
    ]);
  });

  it('converts budgets of currencies without cents', async () => {
    fetchReturning({
      data: [{ id: 'c1', name: 'Tóquio', status: 'ACTIVE', objective: 'OUTCOME_SALES', daily_budget: '5000' }],
    });

    const [campaign] = await provider.listCampaigns('token', {
      externalId: '111',
      currency: 'JPY',
    });

    expect(campaign.budgetAmount).toBe(500000);
  });

  it('reads daily metrics per campaign with the spend in cents', async () => {
    const spy = fetchReturning(
      {
        data: [
          {
            campaign_id: 'c1',
            campaign_name: 'Black Friday',
            date_start: '2026-10-01',
            impressions: '1500',
            reach: '1200',
            clicks: '45',
            spend: '12.34',
            conversions: [
              { action_type: 'purchase', value: '2' },
              { action_type: 'lead', value: '1.5' },
            ],
          },
        ],
        paging: { next: 'https://graph.facebook.com/v25.0/act_111/insights?after=n1' },
      },
      {
        data: [
          {
            campaign_id: 'c1',
            campaign_name: 'Black Friday',
            date_start: '2026-10-02',
            impressions: '10',
            reach: '9',
            clicks: '0',
            spend: '7',
          },
        ],
      }
    );

    const metrics = await provider.dailyMetrics(
      'token',
      { externalId: '111', currency: 'BRL' },
      { from: '2026-10-01', to: '2026-10-02' }
    );

    const first = requestedUrl(spy, 0);
    expect(first.pathname).toBe('/v25.0/act_111/insights');
    expect(first.searchParams.get('level')).toBe('campaign');
    expect(first.searchParams.get('time_increment')).toBe('1');
    expect(JSON.parse(first.searchParams.get('time_range') || '')).toEqual({
      since: '2026-10-01',
      until: '2026-10-02',
    });
    expect(metrics).toEqual([
      { campaignExternalId: 'c1', campaignName: 'Black Friday', date: '2026-10-01', impressions: 1500, reach: 1200, clicks: 45, spend: 1234, conversions: 3.5 },
      { campaignExternalId: 'c1', campaignName: 'Black Friday', date: '2026-10-02', impressions: 10, reach: 9, clicks: 0, spend: 700, conversions: 0 },
    ]);
  });

  it('sends the token in the header and never in the address', async () => {
    const spy = fetchReturning({ data: [] });

    await provider.listAdAccounts('secret-token');

    expect(String(spy.mock.calls[0][0])).not.toContain('secret-token');
    const headers = new Headers(spy.mock.calls[0][1]?.headers);
    expect(headers.get('authorization')).toBe('Bearer secret-token');
  });

  it('fails with the message Meta returns', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        respond({ error: { message: 'Invalid parameter', code: 100 } }, 400)
      );

    await expect(provider.listAdAccounts('token')).rejects.toEqual(
      new AdsApiError('Invalid parameter')
    );
  });

  it('asks for a new login when Meta rejects the token', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        respond({ error: { message: 'Error validating access token', code: 190 } }, 400)
      );

    await expect(provider.listAdAccounts('token')).rejects.toBeInstanceOf(
      AdsReconnectRequiredError
    );
  });
});
