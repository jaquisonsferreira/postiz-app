import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { SYNC_FIELDS } from '@gitroom/nestjs-libraries/database/prisma/ads/ads.repository';


// What the screens and the agent may read about a boost: never the tokens
const BOOST_FIELDS = {
  id: true,
  status: true,
  origin: true,
  name: true,
  objective: true,
  budgetType: true,
  budgetAmount: true,
  days: true,
  startDate: true,
  endDate: true,
  externalCampaignId: true,
  error: true,
  createdAt: true,
  adAccount: { select: { id: true, name: true, provider: true, currency: true } },
  post: {
    select: {
      id: true,
      content: true,
      releaseURL: true,
      integration: { select: { id: true, name: true, picture: true, providerIdentifier: true } },
    },
  },
} as const;

const AUTO_BOOST_FIELDS = {
  id: true,
  objective: true,
  budgetType: true,
  budgetAmount: true,
  days: true,
  audience: true,
  destinationUrl: true,
  texts: true,
  createdAt: true,
  adAccount: { select: { id: true, name: true, provider: true, currency: true } },
  integration: { select: { id: true, name: true, picture: true, providerIdentifier: true } },
} as const;

export interface BoostData {
  organizationId: string;
  adAccountId: string;
  postId: string;
  origin: string;
  status: string;
  name: string;
  reference: string;
  objective: string;
  budgetType: string;
  budgetAmount: number;
  days: number;
  audience: string;
  destinationUrl: string | null;
  texts: string | null;
}

export interface AutoBoostData {
  integrationId: string;
  adAccountId: string;
  objective: string;
  budgetType: string;
  budgetAmount: number;
  days: number;
  audience: string;
  destinationUrl: string | null;
  texts: string | null;
}

@Injectable()
export class AdsBoostRepository {
  constructor(
    private _adBoost: PrismaRepository<'adBoost'>,
    private _adAutoBoost: PrismaRepository<'adAutoBoost'>,
    private _post: PrismaRepository<'post'>,
    private _adAccount: PrismaRepository<'adAccount'>,
    private _integration: PrismaRepository<'integration'>
  ) {}

  getPublishedPost(org: string, id: string) {
    return this._post.model.post.findFirst({
      where: { id, organizationId: org, deletedAt: null },
      select: {
        id: true,
        content: true,
        state: true,
        releaseId: true,
        integration: {
          select: {
            id: true,
            providerIdentifier: true,
            token: true,
            internalId: true,
            picture: true,
          },
        },
      },
    });
  }

  accountsOf(org: string) {
    return this._adAccount.model.adAccount.findMany({
      where: { organizationId: org, deletedAt: null, refreshNeeded: false },
      select: { id: true, name: true, provider: true, currency: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  createBoost(data: BoostData) {
    return this._adBoost.model.adBoost.create({ data, select: BOOST_FIELDS });
  }

  getBoost(org: string, id: string) {
    return this._adBoost.model.adBoost.findFirst({
      where: { id, organizationId: org, deletedAt: null },
      select: BOOST_FIELDS,
    });
  }

  listBoosts(org: string, status?: string) {
    return this._adBoost.model.adBoost.findMany({
      where: { organizationId: org, deletedAt: null, ...(status ? { status } : {}) },
      select: BOOST_FIELDS,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  updateBoost(
    id: string,
    data: {
      status?: string;
      error?: string | null;
      startDate?: Date;
      endDate?: Date;
      externalCampaignId?: string | null;
      externalAdSetId?: string | null;
      externalCreativeId?: string | null;
      externalAdId?: string | null;
    }
  ) {
    return this._adBoost.model.adBoost.update({
      where: { id },
      data,
      select: BOOST_FIELDS,
    });
  }

  async claimBoost(org: string, id: string, status: 'launching' | 'rejected'): Promise<number> {
    const { count } = await this._adBoost.model.adBoost.updateMany({
      where: { id, organizationId: org, deletedAt: null, status: 'awaiting_approval' },
      data: { status },
    });
    return count;
  }

  getBoostToLaunch(id: string) {
    return this._adBoost.model.adBoost.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        status: true,
        name: true,
        reference: true,
        objective: true,
        budgetType: true,
        budgetAmount: true,
        days: true,
        audience: true,
        destinationUrl: true,
        texts: true,
        startDate: true,
        endDate: true,
        externalCampaignId: true,
        externalAdSetId: true,
        externalCreativeId: true,
        externalAdId: true,
        adAccount: { select: SYNC_FIELDS },
      },
    });
  }

  getIntegration(org: string, id: string) {
    return this._integration.model.integration.findFirst({
      where: { id, organizationId: org, deletedAt: null },
      select: { id: true, providerIdentifier: true },
    });
  }

  listAutoBoosts(org: string) {
    return this._adAutoBoost.model.adAutoBoost.findMany({
      where: { organizationId: org },
      select: AUTO_BOOST_FIELDS,
      orderBy: { createdAt: 'asc' },
    });
  }

  upsertAutoBoost(org: string, data: AutoBoostData) {
    return this._adAutoBoost.model.adAutoBoost.upsert({
      where: { integrationId: data.integrationId },
      create: { organizationId: org, ...data },
      update: data,
      select: AUTO_BOOST_FIELDS,
    });
  }

  deleteAutoBoost(org: string, id: string) {
    return this._adAutoBoost.model.adAutoBoost.deleteMany({
      where: { id, organizationId: org },
    });
  }

  autoBoostRules() {
    return this._adAutoBoost.model.adAutoBoost.findMany({
      where: {
        integration: { deletedAt: null, disabled: false },
        adAccount: { deletedAt: null, refreshNeeded: false },
      },
      select: {
        id: true,
        organizationId: true,
        integrationId: true,
        adAccountId: true,
        objective: true,
        budgetType: true,
        budgetAmount: true,
        days: true,
        audience: true,
        destinationUrl: true,
        texts: true,
        createdAt: true,
      },
    });
  }

  // Only posts published after the rule was turned on, and never twice
  postsToAutoBoost(integrationId: string, since: Date) {
    return this._post.model.post.findMany({
      where: {
        integrationId,
        state: 'PUBLISHED',
        deletedAt: null,
        parentPostId: null,
        releaseId: { not: null },
        publishDate: { gte: since },
        adBoosts: { none: {} },
      },
      select: { id: true },
      take: 20,
    });
  }
}
