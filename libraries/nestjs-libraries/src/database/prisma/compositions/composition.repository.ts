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

  // Read after the composition is marked deleted, so it must not filter on it
  getCompositionPosts(org: string, id: string) {
    return this._composition.model.composition.findFirst({
      where: {
        id,
        organizationId: org,
      },
      select: {
        posts: true,
      },
    });
  }

  // A deleted composition is never written again, so an activity that was
  // still running when it was deleted learns it from the count
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
      },
      data,
    });
  }

  // An approval that stopped halfway stays "approving" and can be sent again;
  // flipping a post that is already queued is harmless
  claimApproval(org: string, id: string) {
    return this._composition.model.composition.updateMany({
      where: {
        id,
        organizationId: org,
        deletedAt: null,
        status: {
          in: ['awaiting_approval', 'approving'],
        },
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
