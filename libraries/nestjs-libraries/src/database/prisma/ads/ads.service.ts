import { HttpException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { AdsRepository } from '@gitroom/nestjs-libraries/database/prisma/ads/ads.repository';
import { AdsManager } from '@gitroom/nestjs-libraries/integrations/ads/ads.manager';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import {
  AdsAccountDetails,
  AdsBudgetType,
  AdsCampaignDetails,
  AdsDailyMetric,
  AdsDateRange,
  AdsProvider,
  AdsTokens,
} from '@gitroom/nestjs-libraries/integrations/ads/ads.interface';
import {
  AdsApiError,
  AdsReconnectRequiredError,
} from '@gitroom/nestjs-libraries/integrations/ads/ads.errors';

const LOGIN_TTL_SECONDS = 3600;
const FIRST_SYNC_DAYS = 90;
// Platforms keep adjusting the last days (late conversions, invalid clicks)
const RESYNC_DAYS = 3;
const TOKEN_MARGIN_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SyncAccount {
  id: string;
  organizationId: string;
  name: string;
  provider: string;
  externalId: string;
  loginCustomerId: string | null;
  currency: string;
  token: string;
  refreshToken: string | null;
  tokenExpiration: Date | null;
  lastSyncAt: Date | null;
}

interface PendingConnection {
  organizationId: string;
  provider: string;
  tokens: AdsTokens;
  accounts: AdsAccountDetails[];
}

interface CampaignWithMetrics {
  id: string;
  name: string;
  status: string;
  budgetType: string | null;
  budgetAmount: number | null;
  adAccount: { id: string; provider: string; name: string; currency: string };
  metrics: {
    date: Date;
    impressions: number;
    clicks: number;
    spend: number;
    conversions: number;
  }[];
}

const daysAgo = (days: number) =>
  new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10);

const expirationFrom = (tokens: AdsTokens) =>
  new Date(Date.now() + tokens.expiresIn * 1000);

export const monthStart = (date = new Date()) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));

export const monthKey = (date = new Date()) => date.toISOString().slice(0, 7);

export const referenceOf = (account: SyncAccount) => ({
  externalId: account.externalId,
  currency: account.currency,
  loginCustomerId: account.loginCustomerId,
});

@Injectable()
export class AdsService {
  private readonly _logger = new Logger(AdsService.name);

  constructor(
    private _adsRepository: AdsRepository,
    private _adsManager: AdsManager,
    private _notificationService: NotificationService
  ) {}

  providers() {
    return this._adsManager.getAllProviders();
  }

  listAccounts(org: string) {
    return this._adsRepository.listAccounts(org);
  }

  deleteAccount(org: string, id: string) {
    return this._adsRepository.deleteAccount(org, id);
  }

  async generateAuthUrl(org: string, identifier: string) {
    const provider = this.provider(identifier);
    if (!provider.isConfigured()) {
      throw new HttpException(`${provider.name} is not configured`, 400);
    }
    const { url, state } = await provider.generateAuthUrl();
    await ioRedis.set(`ads:organization:${state}`, org, 'EX', LOGIN_TTL_SECONDS);
    return { url };
  }

  async connect(
    org: string,
    identifier: string,
    { code, state }: { code: string; state: string }
  ) {
    const provider = this.provider(identifier);
    const startedBy = await ioRedis.get(`ads:organization:${state}`);
    if (startedBy !== org) {
      throw new HttpException('The login expired, start it again', 400);
    }
    await ioRedis.del(`ads:organization:${state}`);

    const tokens = await this.callProvider(() => provider.authenticate(code));
    const accounts = await this.callProvider(() =>
      provider.listAdAccounts(tokens.accessToken)
    );

    const connection = randomUUID();
    const pending: PendingConnection = {
      organizationId: org,
      provider: identifier,
      tokens,
      accounts,
    };
    await ioRedis.set(
      `ads:connection:${connection}`,
      AuthService.fixedEncryption(JSON.stringify(pending)),
      'EX',
      LOGIN_TTL_SECONDS
    );

    return { connection, accounts };
  }

  async saveAccounts(org: string, connection: string, externalIds: string[]) {
    const stored = await ioRedis.get(`ads:connection:${connection}`);
    const pending: PendingConnection | null = stored
      ? JSON.parse(AuthService.fixedDecryption(stored))
      : null;
    if (!pending || pending.organizationId !== org) {
      throw new HttpException('The login expired, start it again', 400);
    }
    await ioRedis.del(`ads:connection:${connection}`);

    const chosen = pending.accounts.filter((account) =>
      externalIds.includes(account.externalId)
    );
    for (const account of chosen) {
      const saved = await this._adsRepository.upsertAccount(org, {
        provider: pending.provider,
        externalId: account.externalId,
        loginCustomerId: account.loginCustomerId || null,
        name: account.name,
        currency: account.currency,
        timezone: account.timezone,
        token: AuthService.fixedEncryption(pending.tokens.accessToken),
        refreshToken: AuthService.fixedEncryption(pending.tokens.refreshToken),
        tokenExpiration: expirationFrom(pending.tokens),
      });
      await this.syncLogged(saved);
    }

    return this._adsRepository.listAccounts(org);
  }

  async syncAccount(org: string, id: string) {
    const account = await this.account(org, id);
    try {
      await this.sync(account);
    } catch (err: unknown) {
      if (err instanceof AdsReconnectRequiredError) {
        throw new HttpException('Connect the ad account again', 400);
      }
      throw err;
    }
  }

  async syncAll() {
    const accounts = await this._adsRepository.accountsToSync();
    let synced = 0;
    for (const account of accounts) {
      if (await this.syncLogged(account)) {
        synced += 1;
      }
    }
    return { synced, failed: accounts.length - synced };
  }

  async summary(org: string, range: AdsDateRange) {
    const campaigns: CampaignWithMetrics[] =
      await this._adsRepository.campaignsWithMetrics(
        org,
        new Date(`${range.from}T00:00:00Z`),
        new Date(`${range.to}T00:00:00Z`)
      );

    const visible = campaigns.filter(
      (campaign) => campaign.metrics.length > 0 || campaign.status === 'active'
    );

    const totals = new Map<
      string,
      { currency: string; spend: number; impressions: number; clicks: number; conversions: number }
    >();
    const daily = new Map<
      string,
      { date: string; currency: string; spend: number; impressions: number; clicks: number }
    >();

    const rows = visible.map((campaign) => {
      const { currency } = campaign.adAccount;
      const total = totals.get(currency) || {
        currency,
        spend: 0,
        impressions: 0,
        clicks: 0,
        conversions: 0,
      };
      const row = { spend: 0, impressions: 0, clicks: 0, conversions: 0 };

      for (const metric of campaign.metrics) {
        row.spend += metric.spend;
        row.impressions += metric.impressions;
        row.clicks += metric.clicks;
        row.conversions += metric.conversions;

        const date = metric.date.toISOString().slice(0, 10);
        const key = `${date}:${currency}`;
        const day = daily.get(key) || { date, currency, spend: 0, impressions: 0, clicks: 0 };
        day.spend += metric.spend;
        day.impressions += metric.impressions;
        day.clicks += metric.clicks;
        daily.set(key, day);
      }

      total.spend += row.spend;
      total.impressions += row.impressions;
      total.clicks += row.clicks;
      total.conversions += row.conversions;
      totals.set(currency, total);

      return {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        provider: campaign.adAccount.provider,
        accountName: campaign.adAccount.name,
        currency,
        budgetType: campaign.budgetType,
        budgetAmount: campaign.budgetAmount,
        ...row,
      };
    });

    return {
      totals: [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
      daily: [...daily.values()].sort(
        (a, b) => a.date.localeCompare(b.date) || a.currency.localeCompare(b.currency)
      ),
      campaigns: rows.sort((a, b) => b.spend - a.spend),
    };
  }

  async setCampaignStatus(org: string, id: string, status: 'active' | 'paused') {
    const campaign = await this.campaign(org, id);
    if (campaign.status === 'removed') {
      throw new HttpException('This campaign was removed on the platform', 400);
    }
    if (
      status === 'active' &&
      (await this._adsRepository.getRule(campaign.adAccount.id))?.cappedMonth === monthKey()
    ) {
      throw new HttpException('This ad account reached its monthly budget', 400);
    }
    await this.onPlatform(campaign.adAccount, (provider, accessToken) =>
      provider.setCampaignStatus(
        accessToken,
        referenceOf(campaign.adAccount),
        campaign.externalId,
        status
      )
    );
    return this._adsRepository.updateCampaign(campaign.id, { status });
  }

  async updateCampaignBudget(org: string, id: string, amount: number) {
    const campaign = await this.campaign(org, id);
    if (!campaign.budgetType) {
      throw new HttpException('This campaign has no budget of its own', 400);
    }
    await this.onPlatform(campaign.adAccount, (provider, accessToken) =>
      provider.updateCampaignBudget(
        accessToken,
        referenceOf(campaign.adAccount),
        campaign.externalId,
        campaign.budgetType as AdsBudgetType,
        amount
      )
    );
    return this._adsRepository.updateCampaign(campaign.id, { budgetAmount: amount });
  }

  async budget(org: string) {
    const accounts = await this._adsRepository.listAccountsWithRules(org);
    const from = monthStart();
    return Promise.all(
      accounts.map(async (account) => ({
        accountId: account.id,
        provider: account.provider,
        name: account.name,
        currency: account.currency,
        monthSpend: await this._adsRepository.spendSince(account.id, from),
        rule: account.budgetRule,
      }))
    );
  }

  async saveRule(
    org: string,
    accountId: string,
    rule: { monthlyCap: number | null; approvalThreshold: number | null; alertAt: number | null }
  ) {
    await this.account(org, accountId);
    return this._adsRepository.upsertRule(accountId, rule);
  }

  async deleteRule(org: string, accountId: string) {
    await this.account(org, accountId);
    return this._adsRepository.deleteRule(accountId);
  }

  // Runs after the hourly sync: the cap pauses the account once per month and
  // the alert warns once per month, so pausing by hand later is respected
  async guardBudgets() {
    const month = monthKey();
    const from = monthStart();
    let capped = 0;
    let alerted = 0;

    for (const rule of await this._adsRepository.rulesToGuard()) {
      const cap = rule.monthlyCap || 0;
      const spend = await this._adsRepository.spendSince(rule.adAccount.id, from);

      if (spend >= cap && rule.cappedMonth !== month) {
        const paused = await this.pauseAll(rule.adAccount);
        await this._adsRepository.updateRule(rule.id, { cappedMonth: month, alertedMonth: month });
        await this._notificationService.inAppNotification(
          rule.adAccount.organizationId,
          `${rule.adAccount.name} reached its monthly ad budget`,
          `${rule.adAccount.name} spent ${spend / 100} ${rule.adAccount.currency} this month, the cap is ${cap / 100}. Pauta paused ${paused} campaigns: ${process.env.FRONTEND_URL}/ads`,
          true,
          false,
          'fail'
        );
        capped += 1;
        continue;
      }

      const percent = Math.floor((spend / cap) * 100);
      if (rule.alertAt && percent >= rule.alertAt && rule.alertedMonth !== month && spend < cap) {
        await this._adsRepository.updateRule(rule.id, { alertedMonth: month });
        await this._notificationService.inAppNotification(
          rule.adAccount.organizationId,
          `${rule.adAccount.name} used ${percent}% of its monthly ad budget`,
          `${rule.adAccount.name} spent ${spend / 100} ${rule.adAccount.currency} of ${cap / 100} this month: ${process.env.FRONTEND_URL}/ads`,
          true,
          false,
          'info'
        );
        alerted += 1;
      }
    }

    return { capped, alerted };
  }

  async accessTokenOf(account: SyncAccount) {
    return this.accessToken(account, this.provider(account.provider));
  }

  // Runs a change on the platform: a revoked login marks the account to be
  // connected again, and any platform refusal reaches the user as it came
  async onPlatform<T>(
    account: SyncAccount,
    run: (provider: AdsProvider, accessToken: string) => Promise<T>
  ): Promise<T> {
    const provider = this.provider(account.provider);
    try {
      return await run(provider, await this.accessToken(account, provider));
    } catch (err: unknown) {
      if (err instanceof AdsReconnectRequiredError) {
        await this._adsRepository.markRefreshNeeded(account.id);
        throw new HttpException('Connect the ad account again', 400);
      }
      if (err instanceof AdsApiError) {
        throw new HttpException(err.message, 400);
      }
      throw err;
    }
  }

  private async pauseAll(account: SyncAccount) {
    let paused = 0;
    for (const campaign of await this._adsRepository.activeCampaigns(account.id)) {
      try {
        await this.onPlatform(account, (provider, accessToken) =>
          provider.setCampaignStatus(accessToken, referenceOf(account), campaign.externalId, 'paused')
        );
        await this._adsRepository.updateCampaign(campaign.id, { status: 'paused' });
        paused += 1;
      } catch (err: unknown) {
        this._logger.error(
          `Campaign ${campaign.id} could not be paused by the budget cap: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }
    return paused;
  }

  private async campaign(org: string, id: string) {
    const campaign = await this._adsRepository.getCampaign(org, id);
    if (!campaign) {
      throw new HttpException('Campaign not found', 404);
    }
    return campaign;
  }

  private async account(org: string, id: string) {
    const account = await this._adsRepository.getAccount(org, id);
    if (!account) {
      throw new HttpException('Ad account not found', 404);
    }
    return account;
  }

  private provider(identifier: string): AdsProvider {
    const provider = this._adsManager.getProvider(identifier);
    if (!provider) {
      throw new HttpException('Ads provider not found', 404);
    }
    return provider;
  }

  private async callProvider<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err: unknown) {
      if (err instanceof AdsApiError || err instanceof AdsReconnectRequiredError) {
        throw new HttpException(err.message, 400);
      }
      throw err;
    }
  }

  // The hourly sync and a new connection must not stop on one bad account
  private async syncLogged(account: SyncAccount): Promise<boolean> {
    try {
      await this.sync(account);
      return true;
    } catch (err: unknown) {
      this._logger.error(
        `Ad account ${account.id} could not be synced: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      return false;
    }
  }

  private async sync(account: SyncAccount) {
    const provider = this.provider(account.provider);
    const reference = referenceOf(account);

    try {
      const accessToken = await this.accessToken(account, provider);
      const campaigns = await provider.listCampaigns(accessToken, reference);
      const metrics = await provider.dailyMetrics(accessToken, reference, {
        from: daysAgo(account.lastSyncAt ? RESYNC_DAYS : FIRST_SYNC_DAYS),
        to: daysAgo(0),
      });
      await this.saveSync(account.id, campaigns, metrics);
      await this._adsRepository.markSynced(account.id);
    } catch (err: unknown) {
      if (err instanceof AdsReconnectRequiredError) {
        await this._adsRepository.markRefreshNeeded(account.id);
      }
      throw err;
    }
  }

  private async accessToken(account: SyncAccount, provider: AdsProvider) {
    const expiresSoon =
      !!account.tokenExpiration &&
      account.tokenExpiration.getTime() - TOKEN_MARGIN_MS <= Date.now();
    if (!expiresSoon) {
      return AuthService.fixedDecryption(account.token);
    }

    const tokens = await provider.refreshToken(
      AuthService.fixedDecryption(account.refreshToken || '')
    );
    await this._adsRepository.updateTokens(account.id, {
      token: AuthService.fixedEncryption(tokens.accessToken),
      refreshToken: AuthService.fixedEncryption(tokens.refreshToken),
      tokenExpiration: expirationFrom(tokens),
    });
    return tokens.accessToken;
  }

  // A campaign deleted on the platform leaves the list but its spend in the
  // period still counts, so it is kept as removed
  private async saveSync(
    accountId: string,
    campaigns: AdsCampaignDetails[],
    metrics: AdsDailyMetric[]
  ) {
    const ids = new Map<string, string>();
    for (const campaign of campaigns) {
      const saved = await this._adsRepository.upsertCampaign(accountId, campaign);
      ids.set(saved.externalId, saved.id);
    }

    for (const { campaignExternalId, campaignName, ...metric } of metrics) {
      if (!ids.has(campaignExternalId)) {
        const saved = await this._adsRepository.upsertCampaign(accountId, {
          externalId: campaignExternalId,
          name: campaignName,
          status: 'removed',
          objective: '',
          budgetType: null,
          budgetAmount: null,
        });
        ids.set(saved.externalId, saved.id);
      }
      await this._adsRepository.upsertMetric(ids.get(campaignExternalId)!, metric);
    }
  }
}
