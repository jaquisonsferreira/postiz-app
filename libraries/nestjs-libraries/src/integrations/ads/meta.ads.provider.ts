import { makeSecureId } from '@gitroom/nestjs-libraries/services/make.secure.id';
import { META_GRAPH_API_VERSION } from '@gitroom/nestjs-libraries/integrations/social/facebook.provider';
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

const GRAPH_URL = `https://graph.facebook.com/${META_GRAPH_API_VERSION}`;

// Meta answers 190 when the token expired or the user removed the app
const INVALID_TOKEN_CODE = 190;

// Budgets come in the smallest unit of the currency, and these have no cents
// https://developers.facebook.com/docs/marketing-api/currencies
const CURRENCIES_WITHOUT_CENTS = [
  'CLP',
  'COP',
  'CRC',
  'HUF',
  'ISK',
  'IDR',
  'JPY',
  'KRW',
  'PYG',
  'TWD',
  'VND',
];

const STATUS: Record<string, AdsCampaignStatus> = {
  ACTIVE: 'active',
  PAUSED: 'paused',
};

interface GraphPage<T> {
  data: T[];
  paging?: { next?: string };
}

interface GraphError {
  error?: { message?: string; code?: number };
}

interface MetaAdAccount {
  account_id: string;
  name: string;
  currency: string;
  timezone_name: string;
}

interface MetaCampaign {
  id: string;
  name: string;
  status: string;
  objective: string;
  daily_budget?: string;
  lifetime_budget?: string;
}

interface MetaInsight {
  campaign_id: string;
  campaign_name: string;
  date_start: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  spend?: string;
  conversions?: { action_type: string; value: string }[];
}

const decimalToCents = (value = '0'): number => {
  const [units, fraction = ''] = value.split('.');
  const cents = Number(units) * 100 + Number(fraction.padEnd(3, '0').slice(0, 3)) / 10;
  return Math.round(cents);
};

const budgetToCents = (budget: string, currency: string): number =>
  Number(budget) * (CURRENCIES_WITHOUT_CENTS.includes(currency) ? 100 : 1);

export class MetaAdsProvider implements AdsProvider {
  identifier = 'meta-ads';
  name = 'Meta Ads';
  scopes = ['ads_read', 'business_management'];

  isConfigured() {
    return !!process.env.FACEBOOK_APP_ID && !!process.env.FACEBOOK_APP_SECRET;
  }

  private redirectUri() {
    return `${process.env.FRONTEND_URL}/ads/connect/${this.identifier}`;
  }

  async generateAuthUrl() {
    const state = makeSecureId(6);
    const url = new URL(`https://www.facebook.com/${META_GRAPH_API_VERSION}/dialog/oauth`);
    url.searchParams.set('client_id', process.env.FACEBOOK_APP_ID || '');
    url.searchParams.set('redirect_uri', this.redirectUri());
    url.searchParams.set('state', state);
    url.searchParams.set('scope', this.scopes.join(','));
    return { url: url.toString(), state };
  }

  async authenticate(code: string): Promise<AdsTokens> {
    const exchange = new URL(`${GRAPH_URL}/oauth/access_token`);
    exchange.searchParams.set('client_id', process.env.FACEBOOK_APP_ID || '');
    exchange.searchParams.set('client_secret', process.env.FACEBOOK_APP_SECRET || '');
    exchange.searchParams.set('redirect_uri', this.redirectUri());
    exchange.searchParams.set('code', code);
    const short = await this.request<{ access_token: string }>(exchange);

    const extend = new URL(`${GRAPH_URL}/oauth/access_token`);
    extend.searchParams.set('grant_type', 'fb_exchange_token');
    extend.searchParams.set('client_id', process.env.FACEBOOK_APP_ID || '');
    extend.searchParams.set('client_secret', process.env.FACEBOOK_APP_SECRET || '');
    extend.searchParams.set('fb_exchange_token', short.access_token);
    const long = await this.request<{ access_token: string; expires_in?: number }>(extend);

    return {
      accessToken: long.access_token,
      refreshToken: '',
      expiresIn: long.expires_in || 60 * 24 * 60 * 60,
    };
  }

  async refreshToken(): Promise<AdsTokens> {
    throw new AdsReconnectRequiredError();
  }

  async listAdAccounts(accessToken: string): Promise<AdsAccountDetails[]> {
    const url = new URL(`${GRAPH_URL}/me/adaccounts`);
    url.searchParams.set('fields', 'account_id,name,currency,timezone_name');
    url.searchParams.set('limit', '200');
    const accounts = await this.paginate<MetaAdAccount>(url, accessToken);
    return accounts.map((account) => ({
      externalId: account.account_id,
      name: account.name,
      currency: account.currency,
      timezone: account.timezone_name,
    }));
  }

  async listCampaigns(
    accessToken: string,
    account: AdsAccountReference
  ): Promise<AdsCampaignDetails[]> {
    const url = new URL(`${GRAPH_URL}/act_${account.externalId}/campaigns`);
    url.searchParams.set(
      'fields',
      'id,name,status,objective,daily_budget,lifetime_budget'
    );
    url.searchParams.set('limit', '200');
    const campaigns = await this.paginate<MetaCampaign>(url, accessToken);
    return campaigns.map((campaign) => {
      const budget = campaign.daily_budget || campaign.lifetime_budget;
      return {
        externalId: campaign.id,
        name: campaign.name,
        status: STATUS[campaign.status] || 'removed',
        objective: campaign.objective,
        budgetType: campaign.daily_budget
          ? 'daily'
          : campaign.lifetime_budget
          ? 'lifetime'
          : null,
        budgetAmount: budget ? budgetToCents(budget, account.currency) : null,
      };
    });
  }

  async dailyMetrics(
    accessToken: string,
    account: AdsAccountReference,
    range: AdsDateRange
  ): Promise<AdsDailyMetric[]> {
    const url = new URL(`${GRAPH_URL}/act_${account.externalId}/insights`);
    url.searchParams.set('level', 'campaign');
    url.searchParams.set('time_increment', '1');
    url.searchParams.set(
      'time_range',
      JSON.stringify({ since: range.from, until: range.to })
    );
    url.searchParams.set(
      'fields',
      'campaign_id,campaign_name,impressions,reach,clicks,spend,conversions'
    );
    url.searchParams.set('limit', '500');
    const insights = await this.paginate<MetaInsight>(url, accessToken);
    return insights.map((insight) => ({
      campaignExternalId: insight.campaign_id,
      campaignName: insight.campaign_name,
      date: insight.date_start,
      impressions: Number(insight.impressions || 0),
      reach: Number(insight.reach || 0),
      clicks: Number(insight.clicks || 0),
      spend: decimalToCents(insight.spend),
      conversions: (insight.conversions || []).reduce(
        (total, action) => total + Number(action.value),
        0
      ),
    }));
  }

  private async paginate<T>(first: URL, accessToken: string): Promise<T[]> {
    const items: T[] = [];
    let next: string | undefined = first.toString();
    while (next) {
      const page: GraphPage<T> = await this.request<GraphPage<T>>(
        new URL(next),
        accessToken
      );
      items.push(...page.data);
      next = page.paging?.next;
    }
    return items;
  }

  private async request<T>(url: URL, accessToken?: string): Promise<T> {
    const response = await fetch(url, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    });
    const body = (await response.json()) as T & GraphError;
    if (!response.ok || body.error) {
      if (body.error?.code === INVALID_TOKEN_CODE) {
        throw new AdsReconnectRequiredError(body.error.message);
      }
      throw new AdsApiError(body.error?.message || response.statusText);
    }
    return body;
  }
}
