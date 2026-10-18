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

  it('assumes the usual hour of validity when Google omits expires_in', async () => {
    fetchReturning({ access_token: 'new-access' });

    const tokens = await provider.refreshToken('refresh');

    expect(tokens.expiresIn).toBe(3600);
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

  describe('promoting a YouTube video', () => {
    const account = { externalId: '300', currency: 'BRL', loginCustomerId: '100' };
    const input = {
      name: 'Impulsionar: Tutorial',
      reference: { type: 'youtube-video', id: 'yt123', logoUrl: 'https://cdn.example/logo.png' },
      objective: 'traffic' as const,
      budgetType: 'daily' as const,
      budgetAmount: 5000,
      startDate: new Date('2026-10-18T12:00:00Z'),
      endDate: new Date('2026-10-25T12:00:00Z'),
      audience: { countries: ['BR', 'PT'], ageMin: 18, ageMax: 65 },
      destinationUrl: 'https://loja.example',
      texts: {
        headline: 'Aprenda em 5 minutos',
        longHeadline: 'O tutorial completo para agendar posts',
        description: 'Assista e comece hoje',
        businessName: 'Pauta',
      },
    };

    const mutation = {
      mutateOperationResponses: [
        { campaignBudgetResult: { resourceName: 'customers/300/campaignBudgets/1' } },
        { campaignResult: { resourceName: 'customers/300/campaigns/555' } },
        { adGroupResult: { resourceName: 'customers/300/adGroups/666' } },
        { assetResult: { resourceName: 'customers/300/assets/7' } },
        { assetResult: { resourceName: 'customers/300/assets/8' } },
        { adGroupAdResult: { resourceName: 'customers/300/adGroupAds/666~777' } },
      ],
    };

    const respondWithLogo = (spy: jest.SpyInstance) =>
      spy.mockImplementation(async (url: string | URL) =>
        String(url) === 'https://cdn.example/logo.png'
          ? new Response(Buffer.from('logo-bytes'))
          : respond({})
      );

    it('creates a paused Demand Gen campaign with the video in one atomic call', async () => {
      const spy = jest.spyOn(global, 'fetch');
      spy
        .mockResolvedValueOnce(new Response(Buffer.from('logo-bytes')))
        .mockResolvedValueOnce(
          respond({
            results: [
              { geoTargetConstant: { resourceName: 'geoTargetConstants/2076' } },
              { geoTargetConstant: { resourceName: 'geoTargetConstants/2620' } },
            ],
          })
        )
        .mockResolvedValueOnce(respond(mutation));
      const save = jest.fn();

      const result = await provider.boostPost('access', account, input, {}, save);

      expect(String(spy.mock.calls[0][0])).toBe('https://cdn.example/logo.png');
      expect(JSON.parse(sentBody(spy, 1)).query).toContain(
        "geo_target_constant.country_code IN ('BR', 'PT')"
      );
      expect(String(spy.mock.calls[2][0])).toBe(
        'https://googleads.googleapis.com/v25/customers/300/googleAds:mutate'
      );
      expect(sentHeaders(spy, 2).get('login-customer-id')).toBe('100');
      const operations = JSON.parse(sentBody(spy, 2)).mutateOperations;
      expect(operations[0].campaignBudgetOperation.create).toEqual({
        resourceName: 'customers/300/campaignBudgets/-1',
        name: 'Impulsionar: Tutorial',
        amountMicros: '50000000',
        deliveryMethod: 'STANDARD',
        explicitlyShared: false,
      });
      expect(operations[1].campaignOperation.create).toMatchObject({
        resourceName: 'customers/300/campaigns/-2',
        status: 'PAUSED',
        advertisingChannelType: 'DEMAND_GEN',
        campaignBudget: 'customers/300/campaignBudgets/-1',
        startDateTime: '2026-10-18 00:00:00',
        endDateTime: '2026-10-25 23:59:59',
        containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
      });
      expect(operations[3].assetOperation.create.youtubeVideoAsset).toEqual({ youtubeVideoId: 'yt123' });
      expect(operations[4].assetOperation.create.imageAsset).toEqual({
        data: Buffer.from('logo-bytes').toString('base64'),
      });
      const ad = operations[5].adGroupAdOperation.create;
      expect(ad.adGroup).toBe('customers/300/adGroups/-3');
      expect(ad.ad.finalUrls).toEqual(['https://loja.example']);
      expect(ad.ad.demandGenVideoResponsiveAd).toEqual({
        headlines: [{ text: 'Aprenda em 5 minutos' }],
        longHeadlines: [{ text: 'O tutorial completo para agendar posts' }],
        descriptions: [{ text: 'Assista e comece hoje' }],
        businessName: { text: 'Pauta' },
        videos: [{ asset: 'customers/300/assets/-4' }],
        logoImages: [{ asset: 'customers/300/assets/-5' }],
      });
      expect(operations.slice(6).map((operation: { campaignCriterionOperation: { create: unknown } }) => operation.campaignCriterionOperation.create)).toEqual([
        { campaign: 'customers/300/campaigns/-2', location: { geoTargetConstant: 'geoTargetConstants/2076' } },
        { campaign: 'customers/300/campaigns/-2', location: { geoTargetConstant: 'geoTargetConstants/2620' } },
      ]);
      expect(result).toEqual({ campaignId: '555', adSetId: '666', creativeId: null, adId: '777' });
      expect(save).toHaveBeenCalledWith(result);
    });

    it('does nothing again once the campaign exists, the call is atomic', async () => {
      const spy = jest.spyOn(global, 'fetch');

      const result = await provider.boostPost(
        'access',
        account,
        input,
        { campaignId: '555', adSetId: '666', adId: '777' },
        jest.fn()
      );

      expect(spy).not.toHaveBeenCalled();
      expect(result.campaignId).toBe('555');
    });

    it('needs the landing page and the texts Google shows with the video', async () => {
      respondWithLogo(jest.spyOn(global, 'fetch'));

      await expect(
        provider.boostPost('access', account, { ...input, texts: null }, {}, jest.fn())
      ).rejects.toBeInstanceOf(AdsApiError);
      await expect(
        provider.boostPost('access', account, { ...input, destinationUrl: null }, {}, jest.fn())
      ).rejects.toBeInstanceOf(AdsApiError);
    });

    it('refuses a total budget and posts that are not YouTube videos', async () => {
      respondWithLogo(jest.spyOn(global, 'fetch'));

      await expect(
        provider.boostPost('access', account, { ...input, budgetType: 'lifetime' }, {}, jest.fn())
      ).rejects.toBeInstanceOf(AdsApiError);
      await expect(
        provider.boostPost(
          'access',
          account,
          { ...input, reference: { type: 'meta-post', id: '1_2' } },
          {},
          jest.fn()
        )
      ).rejects.toBeInstanceOf(AdsApiError);
    });
  });

  it('enables and pauses a campaign', async () => {
    const spy = fetchReturning({ results: [] }, { results: [] });
    const account = { externalId: '300', currency: 'BRL', loginCustomerId: '100' };

    await provider.setCampaignStatus('access', account, '555', 'active');
    await provider.setCampaignStatus('access', account, '555', 'paused');

    expect(String(spy.mock.calls[0][0])).toBe(
      'https://googleads.googleapis.com/v25/customers/300/campaigns:mutate'
    );
    expect(JSON.parse(sentBody(spy, 0))).toEqual({
      operations: [
        { update: { resourceName: 'customers/300/campaigns/555', status: 'ENABLED' }, updateMask: 'status' },
      ],
    });
    expect(JSON.parse(sentBody(spy, 1)).operations[0].update.status).toBe('PAUSED');
  });

  it('changes the daily budget behind a campaign', async () => {
    const spy = fetchReturning(
      { results: [{ campaign: { campaignBudget: 'customers/300/campaignBudgets/1' } }] },
      { results: [] }
    );
    const account = { externalId: '300', currency: 'BRL', loginCustomerId: '100' };

    await provider.updateCampaignBudget('access', account, '555', 'daily', 7000);

    expect(JSON.parse(sentBody(spy, 0)).query).toContain('campaign.id = 555');
    expect(String(spy.mock.calls[1][0])).toBe(
      'https://googleads.googleapis.com/v25/customers/300/campaignBudgets:mutate'
    );
    expect(JSON.parse(sentBody(spy, 1))).toEqual({
      operations: [
        { update: { resourceName: 'customers/300/campaignBudgets/1', amountMicros: '70000000' }, updateMask: 'amount_micros' },
      ],
    });
  });

  it('refuses campaign ids that are not numbers, they go inside the query', async () => {
    const spy = jest.spyOn(global, 'fetch');

    await expect(
      provider.updateCampaignBudget(
        'access',
        { externalId: '300', currency: 'BRL' },
        '1 OR 1=1',
        'daily',
        7000
      )
    ).rejects.toBeInstanceOf(AdsApiError);
    expect(spy).not.toHaveBeenCalled();
  });
});
