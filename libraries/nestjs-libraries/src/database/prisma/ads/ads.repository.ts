import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import {
  AdsCampaignDetails,
  AdsDailyMetric,
} from '@gitroom/nestjs-libraries/integrations/ads/ads.interface';

// What the screens may read about an account: never its tokens
const PUBLIC_FIELDS = {
  id: true,
  provider: true,
  externalId: true,
  name: true,
  currency: true,
  timezone: true,
  refreshNeeded: true,
  lastSyncAt: true,
  createdAt: true,
} as const;

export const SYNC_FIELDS = {
  id: true,
  organizationId: true,
  name: true,
  provider: true,
  externalId: true,
  loginCustomerId: true,
  currency: true,
  token: true,
  refreshToken: true,
  tokenExpiration: true,
  lastSyncAt: true,
} as const;

@Injectable()
export class AdsRepository {
  constructor(
    private _adAccount: PrismaRepository<'adAccount'>,
    private _adCampaign: PrismaRepository<'adCampaign'>,
    private _adMetricDaily: PrismaRepository<'adMetricDaily'>,
    private _adBudgetRule: PrismaRepository<'adBudgetRule'>
  ) {}

  listAccounts(org: string) {
    return this._adAccount.model.adAccount.findMany({
      where: { organizationId: org, deletedAt: null },
      select: PUBLIC_FIELDS,
      orderBy: { createdAt: 'asc' },
    });
  }

  getAccount(org: string, id: string) {
    return this._adAccount.model.adAccount.findFirst({
      where: { id, organizationId: org, deletedAt: null },
      select: SYNC_FIELDS,
    });
  }

  accountsToSync() {
    return this._adAccount.model.adAccount.findMany({
      where: { deletedAt: null, refreshNeeded: false },
      select: SYNC_FIELDS,
    });
  }

  upsertAccount(
    org: string,
    data: {
      provider: string;
      externalId: string;
      loginCustomerId: string | null;
      name: string;
      currency: string;
      timezone: string;
      token: string;
      refreshToken: string;
      tokenExpiration: Date;
    }
  ) {
    const values = { ...data, refreshNeeded: false, deletedAt: null as Date | null };
    return this._adAccount.model.adAccount.upsert({
      where: {
        organizationId_provider_externalId: {
          organizationId: org,
          provider: data.provider,
          externalId: data.externalId,
        },
      },
      create: { organizationId: org, ...values },
      update: values,
      select: SYNC_FIELDS,
    });
  }

  deleteAccount(org: string, id: string) {
    return this._adAccount.model.adAccount.updateMany({
      where: { id, organizationId: org, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  updateTokens(
    id: string,
    data: { token: string; refreshToken: string; tokenExpiration: Date }
  ) {
    return this._adAccount.model.adAccount.update({
      where: { id },
      data,
      select: { id: true },
    });
  }

  markRefreshNeeded(id: string) {
    return this._adAccount.model.adAccount.update({
      where: { id },
      data: { refreshNeeded: true },
      select: { id: true },
    });
  }

  markSynced(id: string) {
    return this._adAccount.model.adAccount.update({
      where: { id },
      data: { lastSyncAt: new Date() },
      select: { id: true },
    });
  }

  upsertCampaign(adAccountId: string, campaign: AdsCampaignDetails) {
    return this._adCampaign.model.adCampaign.upsert({
      where: {
        adAccountId_externalId: { adAccountId, externalId: campaign.externalId },
      },
      create: { adAccountId, ...campaign },
      update: campaign,
      select: { id: true, externalId: true },
    });
  }

  upsertMetric(
    adCampaignId: string,
    metric: Omit<AdsDailyMetric, 'campaignExternalId' | 'campaignName'>
  ) {
    const { date, ...values } = metric;
    const day = new Date(`${date}T00:00:00Z`);
    return this._adMetricDaily.model.adMetricDaily.upsert({
      where: { adCampaignId_date: { adCampaignId, date: day } },
      create: { adCampaignId, date: day, ...values },
      update: values,
      select: { id: true },
    });
  }

  campaignsWithMetrics(org: string, from: Date, to: Date) {
    return this._adCampaign.model.adCampaign.findMany({
      where: { adAccount: { organizationId: org, deletedAt: null } },
      select: {
        id: true,
        name: true,
        status: true,
        budgetType: true,
        budgetAmount: true,
        adAccount: {
          select: { id: true, provider: true, name: true, currency: true },
        },
        metrics: {
          where: { date: { gte: from, lte: to } },
          select: {
            date: true,
            impressions: true,
            clicks: true,
            spend: true,
            conversions: true,
          },
          orderBy: { date: 'asc' },
        },
      },
    });
  }

  getCampaign(org: string, id: string) {
    return this._adCampaign.model.adCampaign.findFirst({
      where: { id, adAccount: { organizationId: org, deletedAt: null } },
      select: {
        id: true,
        externalId: true,
        status: true,
        budgetType: true,
        adAccount: { select: SYNC_FIELDS },
      },
    });
  }

  updateCampaign(id: string, data: { status?: string; budgetAmount?: number }) {
    return this._adCampaign.model.adCampaign.update({
      where: { id },
      data,
      select: { id: true, status: true, budgetAmount: true },
    });
  }

  activeCampaigns(adAccountId: string) {
    return this._adCampaign.model.adCampaign.findMany({
      where: { adAccountId, status: 'active' },
      select: { id: true, externalId: true },
    });
  }

  async spendSince(adAccountId: string, from: Date): Promise<number> {
    const { _sum } = await this._adMetricDaily.model.adMetricDaily.aggregate({
      where: { date: { gte: from }, adCampaign: { adAccountId } },
      _sum: { spend: true },
    });
    return _sum.spend || 0;
  }

  listAccountsWithRules(org: string) {
    return this._adAccount.model.adAccount.findMany({
      where: { organizationId: org, deletedAt: null },
      select: {
        id: true,
        provider: true,
        name: true,
        currency: true,
        budgetRule: {
          select: { monthlyCap: true, approvalThreshold: true, alertAt: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  getRule(adAccountId: string) {
    return this._adBudgetRule.model.adBudgetRule.findUnique({
      where: { adAccountId },
      select: { monthlyCap: true, approvalThreshold: true, alertAt: true, cappedMonth: true },
    });
  }

  upsertRule(
    adAccountId: string,
    rule: { monthlyCap: number | null; approvalThreshold: number | null; alertAt: number | null }
  ) {
    return this._adBudgetRule.model.adBudgetRule.upsert({
      where: { adAccountId },
      create: { adAccountId, ...rule },
      update: rule,
      select: { id: true },
    });
  }

  deleteRule(adAccountId: string) {
    return this._adBudgetRule.model.adBudgetRule.deleteMany({
      where: { adAccountId },
    });
  }

  rulesToGuard() {
    return this._adBudgetRule.model.adBudgetRule.findMany({
      where: {
        monthlyCap: { not: null },
        adAccount: { deletedAt: null, refreshNeeded: false },
      },
      select: {
        id: true,
        monthlyCap: true,
        alertAt: true,
        alertedMonth: true,
        cappedMonth: true,
        adAccount: { select: SYNC_FIELDS },
      },
    });
  }

  updateRule(id: string, data: { alertedMonth?: string; cappedMonth?: string }) {
    return this._adBudgetRule.model.adBudgetRule.update({
      where: { id },
      data,
      select: { id: true },
    });
  }
}
