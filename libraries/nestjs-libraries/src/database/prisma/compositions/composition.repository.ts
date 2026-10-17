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

  // Scheduling starts only before it finished: an attempt that resumes after
  // another one scheduled the composition claims nothing
  claimScheduling(id: string) {
    return this._composition.model.composition.updateMany({
      where: {
        id,
        deletedAt: null,
        status: {
          in: ['pending', 'rendering', 'scheduling'],
        },
      },
      data: {
        status: 'scheduling',
      },
    });
  }

  // Written only over the list this attempt started from, while scheduling
  savePosts(id: string, previous: string | null, posts: string) {
    return this._composition.model.composition.updateMany({
      where: {
        id,
        deletedAt: null,
        status: 'scheduling',
        posts: previous,
      },
      data: {
        posts,
      },
    });
  }

  // Finishing starts only from a processing state: an attempt that timed out
  // and resumes after a retry finished (or after the approval) claims nothing
  claimQueueing(id: string) {
    return this._composition.model.composition.updateMany({
      where: {
        id,
        deletedAt: null,
        status: {
          in: ['pending', 'rendering', 'scheduling', 'queueing'],
        },
      },
      data: {
        status: 'queueing',
      },
    });
  }

  finishQueueing(id: string, status: string) {
    return this._composition.model.composition.updateMany({
      where: {
        id,
        deletedAt: null,
        status: 'queueing',
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
  claimApproval(org: string, id: string) {
    return this._composition.model.composition.updateMany({
      where: {
        id,
        organizationId: org,
        deletedAt: null,
        OR: [
          { status: 'awaiting_approval' },
          { status: 'approving', updatedAt: { lt: new Date(Date.now() - 2 * 60 * 1000) } },
        ],
      },
      data: {
        status: 'approving',
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
