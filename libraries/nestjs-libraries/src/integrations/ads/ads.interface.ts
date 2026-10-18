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

// What a social provider says about one of its published posts, so an ads
// provider that knows the same kind can promote it
export interface AdsPromotableReference {
  type: string;
  id: string;
  pageId?: string;
  instagramUserId?: string;
  logoUrl?: string;
}

export type AdsBoostObjective = 'engagement' | 'reach' | 'traffic';

export interface AdsAudience {
  countries: string[];
  ageMin: number;
  ageMax: number;
}

export interface AdsCreativeTexts {
  headline: string;
  longHeadline: string;
  description: string;
  businessName: string;
}

export interface AdsBoostInput {
  name: string;
  reference: AdsPromotableReference;
  objective: AdsBoostObjective;
  budgetType: AdsBudgetType;
  budgetAmount: number;
  startDate: Date;
  endDate: Date;
  audience: AdsAudience;
  destinationUrl?: string | null;
  texts?: AdsCreativeTexts | null;
}

// Ids already created on the platform, saved after every step so a retry
// continues where it stopped instead of creating a second campaign
export interface AdsBoostProgress {
  campaignId?: string | null;
  adSetId?: string | null;
  creativeId?: string | null;
  adId?: string | null;
}

export interface AdsBoostCapabilities {
  promotes: string[];
  objectives: AdsBoostObjective[];
  budgetTypes: AdsBudgetType[];
  needsDestinationUrl: boolean;
  needsTexts: boolean;
}

export interface AdsProvider {
  identifier: string;
  name: string;
  boost: AdsBoostCapabilities;
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
  boostPost(
    accessToken: string,
    account: AdsAccountReference,
    input: AdsBoostInput,
    progress: AdsBoostProgress,
    save: (progress: AdsBoostProgress) => Promise<void>
  ): Promise<AdsBoostProgress>;
  setCampaignStatus(
    accessToken: string,
    account: AdsAccountReference,
    campaignExternalId: string,
    status: 'active' | 'paused'
  ): Promise<void>;
  updateCampaignBudget(
    accessToken: string,
    account: AdsAccountReference,
    campaignExternalId: string,
    budgetType: AdsBudgetType,
    amount: number
  ): Promise<void>;
}
