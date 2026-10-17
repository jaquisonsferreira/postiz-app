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
        organization: true,
      },
    });
  }

  updateComposition(
    id: string,
    data: {
      status?: string;
      media?: string;
      posts?: string;
      error?: string | null;
    }
  ) {
    return this._composition.model.composition.update({
      where: {
        id,
      },
      data,
      select: {
        id: true,
      },
    });
  }

  // Only a composition still waiting for its posts can be claimed for approval,
  // so two approvals racing never schedule the posts twice
  claimApproval(org: string, id: string) {
    return this._composition.model.composition.updateMany({
      where: {
        id,
        organizationId: org,
        deletedAt: null,
        status: 'awaiting_approval',
      },
      data: {
        status: 'scheduled',
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
