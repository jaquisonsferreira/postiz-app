import { HttpException, Injectable, Logger } from '@nestjs/common';
import { TemporalService } from 'nestjs-temporal-core';
import { TypedSearchAttributes } from '@temporalio/common';
import { organizationId } from '@gitroom/nestjs-libraries/temporal/temporal.search.attribute';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import { AdsBoostRepository } from '@gitroom/nestjs-libraries/database/prisma/ads/ads.boost.repository';
import { AdsRepository } from '@gitroom/nestjs-libraries/database/prisma/ads/ads.repository';
import {
  AdsService,
  monthKey,
  referenceOf,
} from '@gitroom/nestjs-libraries/database/prisma/ads/ads.service';
import { AdsManager } from '@gitroom/nestjs-libraries/integrations/ads/ads.manager';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import {
  AdsAudience,
  AdsBoostObjective,
  AdsBoostProgress,
  AdsBudgetType,
  AdsCreativeTexts,
  AdsPromotableReference,
  AdsProvider,
} from '@gitroom/nestjs-libraries/integrations/ads/ads.interface';

const DAY_MS = 24 * 60 * 60 * 1000;
const NAME_LENGTH = 48;

export type BoostOrigin = 'manual' | 'agent' | 'auto';

export interface BoostRequest {
  postId: string;
  adAccountId: string;
  objective: AdsBoostObjective;
  budgetType: AdsBudgetType;
  budgetAmount: number;
  days: number;
  audience: AdsAudience;
  destinationUrl?: string | null;
  texts?: AdsCreativeTexts | null;
}

export type AutoBoostRequest = Omit<BoostRequest, 'postId'> & { integrationId: string };

const nameOf = (content: string) => {
  const text = stripHtmlValidation('none', content).replace(/\s+/g, ' ').trim();
  return `Pauta: ${
    text.length > NAME_LENGTH ? `${text.slice(0, NAME_LENGTH).trimEnd()}…` : text
  }`;
};

@Injectable()
export class AdsBoostService {
  private readonly _logger = new Logger(AdsBoostService.name);

  constructor(
    private _boostRepository: AdsBoostRepository,
    private _adsRepository: AdsRepository,
    private _adsService: AdsService,
    private _adsManager: AdsManager,
    private _integrationManager: IntegrationManager,
    private _temporalService: TemporalService
  ) {}

  async options(org: string, postId: string) {
    const { reference } = await this.promotable(org, postId);
    const accounts = await this._boostRepository.accountsOf(org);
    return {
      reference: reference.type,
      accounts: accounts.flatMap((account) => {
        const provider = this._adsManager.getProvider(account.provider);
        return provider?.boost.promotes.includes(reference.type)
          ? [{ ...account, capabilities: provider.boost }]
          : [];
      }),
    };
  }

  async create(org: string, body: BoostRequest, origin: BoostOrigin) {
    const account = await this._adsRepository.getAccount(org, body.adAccountId);
    if (!account) {
      throw new HttpException('Ad account not found', 404);
    }
    const provider = this._adsManager.getProvider(account.provider);
    if (!provider) {
      throw new HttpException('Ads provider not found', 404);
    }
    this.checkCapabilities(provider, body);

    const { post, reference } = await this.promotable(org, body.postId);
    if (!provider.boost.promotes.includes(reference.type)) {
      throw new HttpException(`${provider.name} cannot promote posts of this channel`, 400);
    }

    const rule = await this._adsRepository.getRule(account.id);
    if (rule?.cappedMonth === monthKey()) {
      throw new HttpException('This ad account reached its monthly budget', 400);
    }
    const total = body.budgetType === 'daily' ? body.budgetAmount * body.days : body.budgetAmount;
    const needsApproval =
      origin === 'agent' ||
      (rule?.approvalThreshold !== null &&
        rule?.approvalThreshold !== undefined &&
        total > rule.approvalThreshold);

    const boost = await this._boostRepository.createBoost({
      organizationId: org,
      adAccountId: account.id,
      postId: post.id,
      origin,
      status: needsApproval ? 'awaiting_approval' : 'launching',
      name: nameOf(post.content),
      reference: JSON.stringify(reference),
      objective: body.objective,
      budgetType: body.budgetType,
      budgetAmount: body.budgetAmount,
      days: body.days,
      audience: JSON.stringify(body.audience),
      destinationUrl: body.destinationUrl || null,
      texts: body.texts ? JSON.stringify(body.texts) : null,
    });

    if (!needsApproval) {
      await this.start(org, boost.id);
    }
    return boost;
  }

  list(org: string, status?: string) {
    return this._boostRepository.listBoosts(org, status);
  }

  async approve(org: string, id: string) {
    await this.awaitingApproval(org, id);
    const boost = await this._boostRepository.updateBoost(id, { status: 'launching' });
    await this.start(org, id);
    return boost;
  }

  async reject(org: string, id: string) {
    await this.awaitingApproval(org, id);
    return this._boostRepository.updateBoost(id, { status: 'rejected' });
  }

  // The dates are fixed on the first attempt and every id the platform gives is
  // saved at once, so a retried launch continues the same campaign
  async launch(id: string) {
    const boost = await this._boostRepository.getBoostToLaunch(id);
    if (!boost || boost.status !== 'launching') {
      return;
    }

    let { startDate, endDate } = boost;
    if (!startDate || !endDate) {
      startDate = new Date();
      endDate = new Date(startDate.getTime() + boost.days * DAY_MS);
      await this._boostRepository.updateBoost(id, { startDate, endDate });
    }

    const account = boost.adAccount;
    const reference = referenceOf(account);
    const progress: AdsBoostProgress = {
      campaignId: boost.externalCampaignId,
      adSetId: boost.externalAdSetId,
      creativeId: boost.externalCreativeId,
      adId: boost.externalAdId,
    };

    const created = await this._adsService.onPlatform(account, (provider, accessToken) =>
      provider.boostPost(
        accessToken,
        reference,
        {
          name: boost.name,
          reference: JSON.parse(boost.reference) as AdsPromotableReference,
          objective: boost.objective as AdsBoostObjective,
          budgetType: boost.budgetType as AdsBudgetType,
          budgetAmount: boost.budgetAmount,
          startDate: startDate!,
          endDate: endDate!,
          audience: JSON.parse(boost.audience) as AdsAudience,
          destinationUrl: boost.destinationUrl,
          texts: boost.texts ? (JSON.parse(boost.texts) as AdsCreativeTexts) : null,
        },
        progress,
        async (saved) => {
          await this._boostRepository.updateBoost(id, {
            externalCampaignId: saved.campaignId || null,
            externalAdSetId: saved.adSetId || null,
            externalCreativeId: saved.creativeId || null,
            externalAdId: saved.adId || null,
          });
        }
      )
    );

    const campaignId = created.campaignId!;
    await this._adsService.onPlatform(account, (provider, accessToken) =>
      provider.setCampaignStatus(accessToken, reference, campaignId, 'active')
    );
    await this._adsRepository.upsertCampaign(account.id, {
      externalId: campaignId,
      name: boost.name,
      status: 'active',
      objective: boost.objective,
      budgetType: boost.budgetType as AdsBudgetType,
      budgetAmount: boost.budgetAmount,
    });
    await this._boostRepository.updateBoost(id, { status: 'active', error: null });
  }

  async fail(id: string, error: string) {
    await this._boostRepository.updateBoost(id, { status: 'failed', error });
  }

  async autoBoost() {
    let created = 0;
    let failed = 0;
    for (const rule of await this._boostRepository.autoBoostRules()) {
      for (const post of await this._boostRepository.postsToAutoBoost(
        rule.integrationId,
        rule.createdAt
      )) {
        try {
          await this.create(
            rule.organizationId,
            {
              postId: post.id,
              adAccountId: rule.adAccountId,
              objective: rule.objective as AdsBoostObjective,
              budgetType: rule.budgetType as AdsBudgetType,
              budgetAmount: rule.budgetAmount,
              days: rule.days,
              audience: JSON.parse(rule.audience) as AdsAudience,
              destinationUrl: rule.destinationUrl,
              texts: rule.texts ? (JSON.parse(rule.texts) as AdsCreativeTexts) : null,
            },
            'auto'
          );
          created += 1;
        } catch (err: unknown) {
          failed += 1;
          this._logger.error(
            `Post ${post.id} could not be boosted automatically: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
      }
    }
    return { created, failed };
  }

  listAutoBoosts(org: string) {
    return this._boostRepository.listAutoBoosts(org);
  }

  async saveAutoBoost(org: string, body: AutoBoostRequest) {
    const account = await this._adsRepository.getAccount(org, body.adAccountId);
    if (!account) {
      throw new HttpException('Ad account not found', 404);
    }
    const integration = await this._boostRepository.getIntegration(org, body.integrationId);
    if (!integration) {
      throw new HttpException('Channel not found', 404);
    }
    if (!this._integrationManager.getSocialIntegration(integration.providerIdentifier)?.promotableReference) {
      throw new HttpException('Posts of this channel cannot be promoted', 400);
    }
    const provider = this._adsManager.getProvider(account.provider);
    if (!provider) {
      throw new HttpException('Ads provider not found', 404);
    }
    this.checkCapabilities(provider, body);

    return this._boostRepository.upsertAutoBoost(org, {
      integrationId: body.integrationId,
      adAccountId: account.id,
      objective: body.objective,
      budgetType: body.budgetType,
      budgetAmount: body.budgetAmount,
      days: body.days,
      audience: JSON.stringify(body.audience),
      destinationUrl: body.destinationUrl || null,
      texts: body.texts ? JSON.stringify(body.texts) : null,
    });
  }

  deleteAutoBoost(org: string, id: string) {
    return this._boostRepository.deleteAutoBoost(org, id);
  }

  private checkCapabilities(
    provider: AdsProvider,
    body: Pick<BoostRequest, 'objective' | 'budgetType' | 'destinationUrl' | 'texts'>
  ) {
    if (!provider.boost.objectives.includes(body.objective)) {
      throw new HttpException(`${provider.name} cannot run this objective`, 400);
    }
    if (!provider.boost.budgetTypes.includes(body.budgetType)) {
      throw new HttpException(`${provider.name} cannot use this kind of budget`, 400);
    }
    if (
      (provider.boost.needsDestinationUrl && !body.destinationUrl) ||
      (provider.boost.needsTexts && !body.texts)
    ) {
      throw new HttpException(`${provider.name} needs a landing page and the ad texts`, 400);
    }
  }

  private async promotable(org: string, postId: string) {
    const post = await this._boostRepository.getPublishedPost(org, postId);
    if (!post) {
      throw new HttpException('Post not found', 404);
    }
    if (post.state !== 'PUBLISHED' || !post.releaseId) {
      throw new HttpException('Only published posts can be promoted', 400);
    }
    const social = this._integrationManager.getSocialIntegration(
      post.integration.providerIdentifier
    );
    if (!social?.promotableReference) {
      throw new HttpException('Posts of this channel cannot be promoted', 400);
    }

    let reference: AdsPromotableReference | undefined;
    try {
      reference = await social.promotableReference(
        post.integration.token,
        post.releaseId,
        post.integration as Parameters<NonNullable<typeof social.promotableReference>>[2]
      );
    } catch (err: unknown) {
      this._logger.error(
        `Post ${post.id} could not be read from its channel: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      throw new HttpException('The post could not be read from its channel', 400);
    }
    if (!reference) {
      throw new HttpException('Posts of this channel cannot be promoted', 400);
    }
    return { post, reference };
  }

  private async awaitingApproval(org: string, id: string) {
    const boost = await this._boostRepository.getBoost(org, id);
    if (!boost) {
      throw new HttpException('Boost not found', 404);
    }
    if (boost.status !== 'awaiting_approval') {
      throw new HttpException('This boost is not waiting for approval', 400);
    }
    return boost;
  }

  private async start(org: string, id: string) {
    const client = this._temporalService.client.getRawClient();
    try {
      if (!client) {
        throw new Error('Temporal client is not available');
      }
      await client.workflow.start('adBoostWorkflow', {
        workflowId: `ad-boost-${id}`,
        taskQueue: 'main',
        args: [{ boostId: id }],
        typedSearchAttributes: new TypedSearchAttributes([
          { key: organizationId, value: org },
        ]),
      });
    } catch (err: unknown) {
      this._logger.error(`Could not start boost ${id}`, err);
      await this._boostRepository.updateBoost(id, {
        status: 'failed',
        error: 'Boosting is not available right now',
      });
      throw new HttpException('Boosting is not available right now', 503);
    }
  }
}
