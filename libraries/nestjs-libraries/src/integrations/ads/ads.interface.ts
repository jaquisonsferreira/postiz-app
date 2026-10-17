export interface AdsTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AdsAccountDetails {
  externalId: string;
  name: string;
  currency: string;
  timezone: string;
  loginCustomerId?: string;
}

export interface AdsAccountReference {
  externalId: string;
  currency: string;
  loginCustomerId?: string | null;
}

export type AdsCampaignStatus = 'active' | 'paused' | 'removed';

export type AdsBudgetType = 'daily' | 'lifetime';

// Money is always in cents of the account currency
export interface AdsCampaignDetails {
  externalId: string;
  name: string;
  status: AdsCampaignStatus;
  objective: string;
  budgetType: AdsBudgetType | null;
  budgetAmount: number | null;
}

export interface AdsDailyMetric {
  campaignExternalId: string;
  campaignName: string;
  date: string;
  impressions: number;
  reach: number | null;
  clicks: number;
  spend: number;
  conversions: number;
}

export interface AdsDateRange {
  from: string;
  to: string;
}

export interface AdsProvider {
  identifier: string;
  name: string;
  isConfigured(): boolean;
  generateAuthUrl(): Promise<{ url: string; state: string }>;
  authenticate(code: string): Promise<AdsTokens>;
  refreshToken(refreshToken: string): Promise<AdsTokens>;
  listAdAccounts(accessToken: string): Promise<AdsAccountDetails[]>;
  listCampaigns(
    accessToken: string,
    account: AdsAccountReference
  ): Promise<AdsCampaignDetails[]>;
  dailyMetrics(
    accessToken: string,
    account: AdsAccountReference,
    range: AdsDateRange
  ): Promise<AdsDailyMetric[]>;
}
