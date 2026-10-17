import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';

const PUBLIC_FIELDS = {
  id: true,
  status: true,
  format: true,
  publishDate: true,
  requiresApproval: true,
  media: true,
  posts: true,
  error: true,
  createdAt: true,
  updatedAt: true,
} as const;

const SCHEDULING_LEASE_MS = 2 * 60 * 1000;

@Injectable()
export class CompositionRepository {
  constructor(private _composition: PrismaRepository<'composition'>) {}

  createComposition(
    org: string,
    data: {
      format: string;
      publishDate: Date;
      requiresApproval: boolean;
      payload: string;
    }
  ) {
    return this._composition.model.composition.create({
      data: {
        organizationId: org,
        ...data,
      },
      select: {
        id: true,
        status: true,
      },
    });
  }

  getComposition(org: string, id: string) {
    return this._composition.model.composition.findFirst({
      where: {
        id,
        organizationId: org,
        deletedAt: null,
      },
      select: PUBLIC_FIELDS,
    });
  }

  getCompositions(org: string, page: number) {
    return this._composition.model.composition.findMany({
      where: {
        organizationId: org,
        deletedAt: null,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 20,
      skip: page * 20,
      select: PUBLIC_FIELDS,
    });
  }

  getCompositionWithContent(org: string, id: string) {
    return this._composition.model.composition.findFirst({
      where: {
        id,
        organizationId: org,
        deletedAt: null,
      },
      select: {
        ...PUBLIC_FIELDS,
        payload: true,
      },
    });
  }

  getCompositionsWithContent(org: string, page: number, status?: string) {
    return this._composition.model.composition.findMany({
      where: {
        organizationId: org,
        deletedAt: null,
        ...(status ? { status } : {}),
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 20,
      skip: page * 20,
      select: {
        ...PUBLIC_FIELDS,
        payload: true,
      },
    });
  }

  countCompositions(org: string, status?: string) {
    return this._composition.model.composition.count({
      where: {
        organizationId: org,
        deletedAt: null,
        ...(status ? { status } : {}),
      },
    });
  }

  getCompositionById(id: string) {
    return this._composition.model.composition.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      select: {
        ...PUBLIC_FIELDS,
        organizationId: true,
        payload: true,
        organization: {
          include: {
            subscription: true,
          },
        },
      },
    });
  }

  // Deletion reads the record even after it was marked deleted, so a deletion
  // that stopped before removing the posts can be sent again
  getCompositionForDeletion(org: string, id: string) {
    return this._composition.model.composition.findFirst({
      where: {
        id,
        organizationId: org,
      },
      select: {
        id: true,
        payload: true,
        posts: true,
      },
    });
  }

  // A deleted or failed composition is never written again, so an activity
  // that was still running (deleted, or timed out and failed) learns it from the count
  updateComposition(
    id: string,
    data: {
      status?: string;
      media?: string;
      posts?: string;
      error?: string | null;
    }
  ) {
    return this._composition.model.composition.updateMany({
      where: {
        id,
        deletedAt: null,
        status: {
          not: 'failed',
        },
      },
      data,
    });
  }

  // Rendering starts only before scheduling: an attempt that resumes after a
  // retry already scheduled the composition claims nothing
  claimRendering(id: string) {
    return this._composition.model.composition.updateMany({
      where: {
        id,
        deletedAt: null,
        status: {
          in: ['pending', 'rendering'],
        },
      },
      data: {
        status: 'rendering',
      },
    });
  }

  // One scheduling attempt at a time: the lease is taken before scheduling
  // starts, or from an attempt that has been silent for two minutes, so a
  // retry that starts while a timed-out attempt is still running waits for it
  claimScheduling(id: string, lease: string) {
    return this._composition.model.composition.updateMany({
      where: {
        id,
        deletedAt: null,
        OR: [
          { status: { in: ['pending', 'rendering'] } },
          { status: 'scheduling', updatedAt: { lt: new Date(Date.now() - SCHEDULING_LEASE_MS) } },
        ],
      },
      data: {
        status: 'scheduling',
        schedulingLease: lease,
      },
    });
  }

  // Renews the lease before a channel is touched, and confirms that no other
  // attempt saved a post since this one last read the list
  holdScheduling(id: string, lease: string, previous: string | null) {
    return this._composition.model.composition.updateMany({
      where: {
        id,
        deletedAt: null,
        status: 'scheduling',
        schedulingLease: lease,
        posts: previous,
      },
      data: {
        schedulingLease: lease,
      },
    });
  }

  // Written only by the lease holder, over the list it started from
  savePosts(id: string, lease: string, previous: string | null, posts: string) {
    return this._composition.model.composition.updateMany({
      where: {
        id,
        deletedAt: null,
        status: 'scheduling',
        schedulingLease: lease,
        posts: previous,
      },
      data: {
        posts,
      },
    });
  }

  // Queueing takes the same lease: from a processing state, or from a
  // queueing attempt that has been silent for two minutes, so two attempts
  // never start the publishing workflows of the same posts at once
  claimQueueing(id: string, lease: string) {
    return this._composition.model.composition.updateMany({
      where: {
        id,
        deletedAt: null,
        OR: [
          { status: { in: ['pending', 'rendering', 'scheduling'] } },
          { status: 'queueing', updatedAt: { lt: new Date(Date.now() - SCHEDULING_LEASE_MS) } },
        ],
      },
      data: {
        status: 'queueing',
        schedulingLease: lease,
      },
    });
  }

  holdQueueing(id: string, lease: string) {
    return this._composition.model.composition.updateMany({
      where: {
        id,
        deletedAt: null,
        status: 'queueing',
        schedulingLease: lease,
      },
      data: {
        schedulingLease: lease,
      },
    });
  }

  finishQueueing(id: string, lease: string, status: string) {
    return this._composition.model.composition.updateMany({
      where: {
        id,
        deletedAt: null,
        status: 'queueing',
        schedulingLease: lease,
      },
      data: {
        status,
        error: null,
      },
    });
  }

  markFailed(id: string, error: string) {
    return this._composition.model.composition.updateMany({
      where: {
        id,
        deletedAt: null,
      },
      data: {
        status: 'failed',
        error,
      },
    });
  }

  // Written only over the value this attempt started from: a stale render
  // attempt that resumes after a retry already saved more slides writes nothing
  saveMedia(id: string, previous: string | null, media: string) {
    return this._composition.model.composition.updateMany({
      where: {
        id,
        deletedAt: null,
        status: {
          not: 'failed',
        },
        media: previous,
      },
      data: {
        media,
      },
    });
  }

  // One approval at a time: an "approving" composition can be claimed again
  // only once the approval holding it has been silent for two minutes, so an
  // approval that stopped halfway can be sent again but two at once can't run
  claimApproval(org: string, id: string, lease: string) {
    return this._composition.model.composition.updateMany({
      where: {
        id,
        organizationId: org,
        deletedAt: null,
        OR: [
          { status: 'awaiting_approval' },
          { status: 'approving', updatedAt: { lt: new Date(Date.now() - SCHEDULING_LEASE_MS) } },
        ],
      },
      data: {
        status: 'approving',
        schedulingLease: lease,
      },
    });
  }

  holdApproval(id: string, lease: string) {
    return this._composition.model.composition.updateMany({
      where: {
        id,
        deletedAt: null,
        status: 'approving',
        schedulingLease: lease,
      },
      data: {
        schedulingLease: lease,
      },
    });
  }

  finishApproval(id: string, lease: string) {
    return this._composition.model.composition.updateMany({
      where: {
        id,
        deletedAt: null,
        status: 'approving',
        schedulingLease: lease,
      },
      data: {
        status: 'scheduled',
        error: null,
      },
    });
  }

  deleteComposition(org: string, id: string) {
    return this._composition.model.composition.updateMany({
      where: {
        id,
        organizationId: org,
        deletedAt: null,
      },
      data: {
        deletedAt: new Date(),
      },
    });
  }
}
