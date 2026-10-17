import { GoogleAdsProvider } from '@gitroom/nestjs-libraries/integrations/ads/google.ads.provider';
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

const sentBody = (spy: jest.SpyInstance, call: number) =>
  String(spy.mock.calls[call][1]?.body);

const sentHeaders = (spy: jest.SpyInstance, call: number) =>
  new Headers(spy.mock.calls[call][1]?.headers);

describe('GoogleAdsProvider', () => {
  const provider = new GoogleAdsProvider();

  beforeEach(() => {
    process.env.GOOGLE_ADS_CLIENT_ID = 'client-id';
    process.env.GOOGLE_ADS_CLIENT_SECRET = 'client-secret';
    process.env.FRONTEND_URL = 'https://pauta.example';
    delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('is available only when the Google Ads client is configured', () => {
    expect(provider.isConfigured()).toBe(true);
    delete process.env.GOOGLE_ADS_CLIENT_SECRET;
    expect(provider.isConfigured()).toBe(false);
  });

  it('asks for offline access to the adwords scope', async () => {
    const { url, state } = await provider.generateAuthUrl();
    const parsed = new URL(url);

    expect(parsed.origin + parsed.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth'
    );
    expect(parsed.searchParams.get('client_id')).toBe('client-id');
    expect(parsed.searchParams.get('scope')).toBe(
      'https://www.googleapis.com/auth/adwords'
    );
    expect(parsed.searchParams.get('access_type')).toBe('offline');
    expect(parsed.searchParams.get('prompt')).toBe('consent');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('redirect_uri')).toBe(
      'https://pauta.example/ads/connect/google-ads'
    );
    expect(parsed.searchParams.get('state')).toBe(state);
  });

  it('exchanges the code for an access and a refresh token', async () => {
    const spy = fetchReturning({
      access_token: 'access',
      refresh_token: 'refresh',
      expires_in: 3599,
    });

    const tokens = await provider.authenticate('the-code');

    expect(String(spy.mock.calls[0][0])).toBe('https://oauth2.googleapis.com/token');
    const body = new URLSearchParams(sentBody(spy, 0));
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('the-code');
    expect(body.get('redirect_uri')).toBe(
      'https://pauta.example/ads/connect/google-ads'
    );
    expect(tokens).toEqual({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresIn: 3599,
    });
  });

  it('keeps the refresh token when Google does not send a new one', async () => {
    const spy = fetchReturning({ access_token: 'new-access', expires_in: 3599 });

    const tokens = await provider.refreshToken('refresh');

    const body = new URLSearchParams(sentBody(spy, 0));
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('refresh');
    expect(tokens).toEqual({
      accessToken: 'new-access',
      refreshToken: 'refresh',
      expiresIn: 3599,
    });
  });

  it('asks for a new login when the refresh token was revoked', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(respond({ error: 'invalid_grant' }, 400));

    await expect(provider.refreshToken('refresh')).rejects.toBeInstanceOf(
      AdsReconnectRequiredError
    );
  });

  it('lists the client accounts under every accessible customer, without managers', async () => {
    const spy = fetchReturning(
      { resourceNames: ['customers/100', 'customers/200'] },
      {
        results: [
          { customerClient: { id: '100', descriptiveName: 'Agência', currencyCode: 'BRL', timeZone: 'America/Sao_Paulo', manager: true } },
          { customerClient: { id: '300', descriptiveName: 'Loja', currencyCode: 'BRL', timeZone: 'America/Sao_Paulo', manager: false } },
        ],
      },
      {
        results: [
          { customerClient: { id: '200', descriptiveName: 'Clínica', currencyCode: 'USD', timeZone: 'America/New_York', manager: false } },
          { customerClient: { id: '300', descriptiveName: 'Loja', currencyCode: 'BRL', timeZone: 'America/Sao_Paulo', manager: false } },
        ],
      }
    );

    const accounts = await provider.listAdAccounts('access');

    expect(String(spy.mock.calls[0][0])).toBe(
      'https://googleads.googleapis.com/v25/customers:listAccessibleCustomers'
    );
    expect(String(spy.mock.calls[1][0])).toBe(
      'https://googleads.googleapis.com/v25/customers/100/googleAds:search'
    );
    expect(sentHeaders(spy, 1).get('login-customer-id')).toBe('100');
    expect(accounts).toEqual([
      { externalId: '300', name: 'Loja', currency: 'BRL', timezone: 'America/Sao_Paulo', loginCustomerId: '100' },
      { externalId: '200', name: 'Clínica', currency: 'USD', timezone: 'America/New_York', loginCustomerId: '200' },
    ]);
  });

  it('maps campaigns with their status and budget in cents', async () => {
    const spy = fetchReturning({
      results: [
        { campaign: { id: '1', name: 'Pesquisa', status: 'ENABLED', advertisingChannelType: 'SEARCH' }, campaignBudget: { amountMicros: '50000000' } },
        { campaign: { id: '2', name: 'Vídeo', status: 'PAUSED', advertisingChannelType: 'VIDEO' }, campaignBudget: { totalAmountMicros: '1200000000' } },
        { campaign: { id: '3', name: 'Velha', status: 'REMOVED', advertisingChannelType: 'DISPLAY' } },
      ],
    });

    const campaigns = await provider.listCampaigns('access', {
      externalId: '300',
      currency: 'BRL',
      loginCustomerId: '100',
    });

    expect(String(spy.mock.calls[0][0])).toBe(
      'https://googleads.googleapis.com/v25/customers/300/googleAds:search'
    );
    expect(sentHeaders(spy, 0).get('login-customer-id')).toBe('100');
    expect(campaigns).toEqual([
      { externalId: '1', name: 'Pesquisa', status: 'active', objective: 'SEARCH', budgetType: 'daily', budgetAmount: 5000 },
      { externalId: '2', name: 'Vídeo', status: 'paused', objective: 'VIDEO', budgetType: 'lifetime', budgetAmount: 120000 },
      { externalId: '3', name: 'Velha', status: 'removed', objective: 'DISPLAY', budgetType: null, budgetAmount: null },
    ]);
  });

  it('reads daily metrics across pages with the cost in cents', async () => {
    const spy = fetchReturning(
      {
        results: [
          {
            campaign: { id: '1', name: 'Pesquisa' },
            segments: { date: '2026-10-01' },
            metrics: { impressions: '1500', clicks: '45', costMicros: '12340000', conversions: 3.5 },
          },
        ],
        nextPageToken: 'next',
      },
      {
        results: [
          {
            campaign: { id: '1', name: 'Pesquisa' },
            segments: { date: '2026-10-02' },
            metrics: { impressions: '10' },
          },
        ],
      }
    );

    const metrics = await provider.dailyMetrics(
      'access',
      { externalId: '300', currency: 'BRL', loginCustomerId: '100' },
      { from: '2026-10-01', to: '2026-10-02' }
    );

    const firstQuery = JSON.parse(sentBody(spy, 0));
    expect(firstQuery.query).toContain(
      "segments.date BETWEEN '2026-10-01' AND '2026-10-02'"
    );
    expect(JSON.parse(sentBody(spy, 1)).pageToken).toBe('next');
    expect(metrics).toEqual([
      { campaignExternalId: '1', campaignName: 'Pesquisa', date: '2026-10-01', impressions: 1500, reach: null, clicks: 45, spend: 1234, conversions: 3.5 },
      { campaignExternalId: '1', campaignName: 'Pesquisa', date: '2026-10-02', impressions: 10, reach: null, clicks: 0, spend: 0, conversions: 0 },
    ]);
  });

  it('refuses dates that are not plain days, they go inside the query', async () => {
    await expect(
      provider.dailyMetrics(
        'access',
        { externalId: '300', currency: 'BRL' },
        { from: "2026-10-01' OR '1'='1", to: '2026-10-02' }
      )
    ).rejects.toBeInstanceOf(AdsApiError);
  });

  it('sends the developer token only when it is configured', async () => {
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'dev-token';
    const spy = fetchReturning({ resourceNames: [] });

    await provider.listAdAccounts('access');

    expect(sentHeaders(spy, 0).get('developer-token')).toBe('dev-token');
    expect(sentHeaders(spy, 0).get('authorization')).toBe('Bearer access');
  });

  it('fails with the message Google returns', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      respond(
        { error: { code: 403, message: 'The caller does not have permission', status: 'PERMISSION_DENIED' } },
        403
      )
    );

    await expect(provider.listAdAccounts('access')).rejects.toEqual(
      new AdsApiError('The caller does not have permission')
    );
  });
});
