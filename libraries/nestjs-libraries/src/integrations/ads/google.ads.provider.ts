import { makeSecureId } from '@gitroom/nestjs-libraries/services/make.secure.id';
import {
  AdsAccountDetails,
  AdsAccountReference,
  AdsCampaignDetails,
  AdsCampaignStatus,
  AdsDailyMetric,
  AdsDateRange,
  AdsProvider,
  AdsTokens,
} from '@gitroom/nestjs-libraries/integrations/ads/ads.interface';
import {
  AdsApiError,
  AdsReconnectRequiredError,
} from '@gitroom/nestjs-libraries/integrations/ads/ads.errors';

const GOOGLE_ADS_API_VERSION = 'v25';
const API_URL = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`;
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const STATUS: Record<string, AdsCampaignStatus> = {
  ENABLED: 'active',
  PAUSED: 'paused',
};

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
}

interface GoogleSearchPage<T> {
  results?: T[];
  nextPageToken?: string;
}

interface GoogleError {
  error?: { message?: string; status?: string };
}

interface CustomerClientRow {
  customerClient: {
    id: string;
    descriptiveName?: string;
    currencyCode: string;
    timeZone: string;
    manager?: boolean;
  };
}

interface CampaignRow {
  campaign: {
    id: string;
    name: string;
    status: string;
    advertisingChannelType: string;
  };
  campaignBudget?: { amountMicros?: string; totalAmountMicros?: string };
}

interface MetricRow {
  campaign: { id: string; name: string };
  segments: { date: string };
  metrics: {
    impressions?: string;
    clicks?: string;
    costMicros?: string;
    conversions?: number;
  };
}

const microsToCents = (micros = '0'): number => Math.round(Number(micros) / 10000);

export class GoogleAdsProvider implements AdsProvider {
  identifier = 'google-ads';
  name = 'Google Ads';
  scopes = ['https://www.googleapis.com/auth/adwords'];

  isConfigured() {
    return (
      !!process.env.GOOGLE_ADS_CLIENT_ID && !!process.env.GOOGLE_ADS_CLIENT_SECRET
    );
  }

  private redirectUri() {
    return `${process.env.FRONTEND_URL}/ads/connect/${this.identifier}`;
  }

  async generateAuthUrl() {
    const state = makeSecureId(7);
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', process.env.GOOGLE_ADS_CLIENT_ID || '');
    url.searchParams.set('redirect_uri', this.redirectUri());
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', this.scopes.join(' '));
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('state', state);
    return { url: url.toString(), state };
  }

  async authenticate(code: string): Promise<AdsTokens> {
    const tokens = await this.token({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri(),
    });
    return {
      accessToken: tokens.access_token || '',
      refreshToken: tokens.refresh_token || '',
      expiresIn: tokens.expires_in || 0,
    };
  }

  async refreshToken(refreshToken: string): Promise<AdsTokens> {
    const tokens = await this.token({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    return {
      accessToken: tokens.access_token || '',
      refreshToken: tokens.refresh_token || refreshToken,
      expiresIn: tokens.expires_in || 0,
    };
  }

  // A manager account (MCC) gives access to its clients only through itself,
  // so every accessible customer is asked for the accounts below it
  async listAdAccounts(accessToken: string): Promise<AdsAccountDetails[]> {
    const { resourceNames = [] } = await this.request<{ resourceNames?: string[] }>(
      `${API_URL}/customers:listAccessibleCustomers`,
      accessToken,
      {}
    );

    const accounts = new Map<string, AdsAccountDetails>();
    for (const resourceName of resourceNames) {
      const root = resourceName.split('/').pop() || '';
      const clients = await this.search<CustomerClientRow>(
        accessToken,
        { externalId: root, currency: '', loginCustomerId: root },
        'SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.time_zone, customer_client.manager FROM customer_client WHERE customer_client.level <= 1'
      );
      for (const { customerClient } of clients) {
        if (customerClient.manager || accounts.has(customerClient.id)) {
          continue;
        }
        accounts.set(customerClient.id, {
          externalId: customerClient.id,
          name: customerClient.descriptiveName || customerClient.id,
          currency: customerClient.currencyCode,
          timezone: customerClient.timeZone,
          loginCustomerId: root,
        });
      }
    }
    return [...accounts.values()];
  }

  async listCampaigns(
    accessToken: string,
    account: AdsAccountReference
  ): Promise<AdsCampaignDetails[]> {
    const rows = await this.search<CampaignRow>(
      accessToken,
      account,
      'SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign_budget.amount_micros, campaign_budget.total_amount_micros FROM campaign'
    );
    return rows.map(({ campaign, campaignBudget }) => ({
      externalId: campaign.id,
      name: campaign.name,
      status: STATUS[campaign.status] || 'removed',
      objective: campaign.advertisingChannelType,
      budgetType: campaignBudget?.amountMicros
        ? 'daily'
        : campaignBudget?.totalAmountMicros
        ? 'lifetime'
        : null,
      budgetAmount:
        campaignBudget?.amountMicros || campaignBudget?.totalAmountMicros
          ? microsToCents(
              campaignBudget.amountMicros || campaignBudget.totalAmountMicros
            )
          : null,
    }));
  }

  async dailyMetrics(
    accessToken: string,
    account: AdsAccountReference,
    range: AdsDateRange
  ): Promise<AdsDailyMetric[]> {
    if (!DAY.test(range.from) || !DAY.test(range.to)) {
      throw new AdsApiError('Dates must be in the YYYY-MM-DD format');
    }

    const rows = await this.search<MetricRow>(
      accessToken,
      account,
      `SELECT campaign.id, campaign.name, segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign WHERE segments.date BETWEEN '${range.from}' AND '${range.to}'`
    );
    return rows.map(({ campaign, segments, metrics }) => ({
      campaignExternalId: campaign.id,
      campaignName: campaign.name,
      date: segments.date,
      impressions: Number(metrics.impressions || 0),
      reach: null,
      clicks: Number(metrics.clicks || 0),
      spend: microsToCents(metrics.costMicros),
      conversions: metrics.conversions || 0,
    }));
  }

  private async search<T>(
    accessToken: string,
    account: AdsAccountReference,
    query: string
  ): Promise<T[]> {
    const rows: T[] = [];
    let pageToken: string | undefined;
    do {
      const page: GoogleSearchPage<T> = await this.request<GoogleSearchPage<T>>(
        `${API_URL}/customers/${account.externalId}/googleAds:search`,
        accessToken,
        { loginCustomerId: account.loginCustomerId, body: { query, pageToken } }
      );
      rows.push(...(page.results || []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return rows;
  }

  private async request<T>(
    url: string,
    accessToken: string,
    {
      loginCustomerId,
      body,
    }: { loginCustomerId?: string | null; body?: Record<string, unknown> }
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    };
    if (process.env.GOOGLE_ADS_DEVELOPER_TOKEN) {
      headers['developer-token'] = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    }
    if (loginCustomerId) {
      headers['login-customer-id'] = loginCustomerId;
    }

    const response = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = (await response.json()) as T & GoogleError;
    if (!response.ok || result.error) {
      if (response.status === 401) {
        throw new AdsReconnectRequiredError(result.error?.message);
      }
      throw new AdsApiError(result.error?.message || response.statusText);
    }
    return result;
  }

  private async token(params: Record<string, string>): Promise<GoogleTokenResponse> {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_ADS_CLIENT_ID || '',
        client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET || '',
        ...params,
      }).toString(),
    });
    const tokens = (await response.json()) as GoogleTokenResponse;
    if (tokens.error === 'invalid_grant') {
      throw new AdsReconnectRequiredError();
    }
    if (!response.ok || tokens.error) {
      throw new AdsApiError(tokens.error || response.statusText);
    }
    return tokens;
  }
}
