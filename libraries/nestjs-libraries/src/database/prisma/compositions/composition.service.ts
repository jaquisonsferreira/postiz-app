import { BadRequestException, HttpException, Injectable, Logger } from '@nestjs/common';
import { Organization } from '@prisma/client';
import { TypedSearchAttributes } from '@temporalio/common';
import { TemporalService } from 'nestjs-temporal-core';
import sharp from 'sharp';
import { CompositionRepository } from '@gitroom/nestjs-libraries/database/prisma/compositions/composition.repository';
import { CreateCompositionDto } from '@gitroom/nestjs-libraries/dtos/compositions/create.composition.dto';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { organizationId } from '@gitroom/nestjs-libraries/temporal/temporal.search.attribute';
import { ssrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { ChromiumSlideRenderer } from '@gitroom/nestjs-libraries/compositions/chromium.slide.renderer';
import {
  buildSlideHtml,
  CompositionBrand,
  DEFAULT_BRAND,
  SlideSize,
} from '@gitroom/nestjs-libraries/compositions/composition.slide.template';
import {
  buildCompositionPosts,
  CompositionMedia,
  CompositionPostsInput,
} from '@gitroom/nestjs-libraries/compositions/composition.posts.builder';
import { CompositionValidationError } from '@gitroom/nestjs-libraries/compositions/composition.errors';

export type CompositionStatus =
  | 'pending'
  | 'rendering'
  | 'scheduling'
  | 'awaiting_approval'
  | 'scheduled'
  | 'failed';

export interface CompositionPost {
  postId: string;
  integration: string;
}

const SIZES: Record<NonNullable<CreateCompositionDto['size']>, SlideSize> = {
  portrait: { width: 1080, height: 1350 },
  square: { width: 1080, height: 1080 },
  story: { width: 1080, height: 1920 },
};

const MAX_REMOTE_IMAGE_BYTES = 15 * 1024 * 1024;

const describeBadRequest = (err: BadRequestException): string => {
  const message = (err.getResponse() as { message?: string | string[] }).message;
  return Array.isArray(message) ? message.join('; ') : message || err.message;
};

const parseList = <T>(value: string | null): T[] => (value ? (JSON.parse(value) as T[]) : []);

@Injectable()
export class CompositionService {
  private readonly _logger = new Logger(CompositionService.name);
  private readonly _storage = UploadFactory.createStorage();

  constructor(
    private _compositionRepository: CompositionRepository,
    private _integrationService: IntegrationService,
    private _postsService: PostsService,
    private _mediaService: MediaService,
    private _temporalService: TemporalService
  ) {}

  private present(
    composition: NonNullable<Awaited<ReturnType<CompositionRepository['getComposition']>>>
  ) {
    return {
      ...composition,
      media: parseList<CompositionMedia>(composition.media),
      posts: parseList<CompositionPost>(composition.posts),
    };
  }

  private async resolveTargets(org: string, targets: CreateCompositionDto['targets']) {
    const resolved = [];
    for (const target of targets) {
      const integration = await this._integrationService.getIntegrationById(
        org,
        target.integrationId
      );
      if (!integration || integration.deletedAt || integration.disabled) {
        throw new CompositionValidationError(`Channel ${target.integrationId} is not available`);
      }
      resolved.push({ ...target, providerIdentifier: integration.providerIdentifier });
    }
    return resolved;
  }

  // The provider settings are checked the way the public posts route checks
  // them, so a channel that needs a setting answers with that setting's name
  private async mapPosts(org: string, input: CompositionPostsInput) {
    try {
      return await this._postsService.mapTypeToPost(buildCompositionPosts(input), org);
    } catch (err: unknown) {
      if (err instanceof BadRequestException) {
        throw new CompositionValidationError(describeBadRequest(err));
      }
      throw err;
    }
  }

  async startComposition(org: Organization, body: CreateCompositionDto) {
    try {
      await this.mapPosts(org.id, {
        compositionId: 'validation',
        date: body.date,
        requiresApproval: !!body.requiresApproval,
        targets: await this.resolveTargets(org.id, body.targets),
        media: [],
        tags: body.tags,
      });
    } catch (err: unknown) {
      if (err instanceof CompositionValidationError) {
        throw new HttpException(err.message, 400);
      }
      throw err;
    }

    const client = this._temporalService.client.getRawClient();
    if (!client) {
      throw new HttpException('Compositions are not available', 503);
    }

    const composition = await this._compositionRepository.createComposition(org.id, {
      format: body.format,
      publishDate: new Date(body.date),
      requiresApproval: !!body.requiresApproval,
      payload: JSON.stringify(body),
    });

    try {
      await client.workflow.start('compositionWorkflow', {
        workflowId: `composition_${composition.id}`,
        taskQueue: 'main',
        args: [{ compositionId: composition.id }],
        typedSearchAttributes: new TypedSearchAttributes([
          {
            key: organizationId,
            value: org.id,
          },
        ]),
      });
    } catch (err: unknown) {
      this._logger.error(`Could not start composition ${composition.id}`, err);
      await this._compositionRepository.updateComposition(composition.id, {
        status: 'failed',
        error: 'Could not start the composition',
      });
      throw new HttpException('Compositions are not available', 503);
    }

    return composition;
  }

  async getComposition(org: string, id: string) {
    const composition = await this._compositionRepository.getComposition(org, id);
    if (!composition) {
      throw new HttpException('Composition not found', 404);
    }
    return this.present(composition);
  }

  async getCompositions(org: string, page: number) {
    return (await this._compositionRepository.getCompositions(org, page || 0)).map((c) =>
      this.present(c)
    );
  }

  async approveComposition(org: string, id: string) {
    const composition = await this.getComposition(org, id);
    const claimed = await this._compositionRepository.claimApproval(org, id);
    if (!claimed.count) {
      throw new HttpException(
        `Only a composition awaiting approval can be approved, this one is ${composition.status}`,
        400
      );
    }

    for (const post of composition.posts) {
      await this._postsService.changePostStatus(org, post.postId, 'schedule');
    }

    return this.getComposition(org, id);
  }

  async deleteComposition(org: string, id: string) {
    const composition = await this.getComposition(org, id);

    try {
      const handle = await this._temporalService.client.getWorkflowHandle(`composition_${id}`);
      if ((await handle.describe()).status.name === 'RUNNING') {
        await handle.terminate('Composition deleted');
      }
    } catch (err: unknown) {
      this._logger.warn(
        `Composition ${id} has no running workflow: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }

    for (const post of composition.posts) {
      const existing = await this._postsService.getPostById(post.postId, org);
      if (existing && !existing.deletedAt) {
        await this._postsService.deletePost(org, existing.group);
      }
    }

    await this._compositionRepository.deleteComposition(org, id);
    return { id };
  }

  private async loadForProcessing(id: string) {
    const composition = await this._compositionRepository.getCompositionById(id);
    if (!composition) {
      throw new CompositionValidationError('The composition was deleted');
    }
    return {
      ...composition,
      body: JSON.parse(composition.payload) as CreateCompositionDto,
      media: parseList<CompositionMedia>(composition.media),
      posts: parseList<CompositionPost>(composition.posts),
    };
  }

  private async remoteImage(url: string): Promise<string> {
    let response: globalThis.Response;
    try {
      response = await fetch(url, {
        // @ts-ignore — undici option, not in lib.dom fetch types
        dispatcher: ssrfSafeDispatcher,
      });
    } catch (err: unknown) {
      throw new CompositionValidationError(
        `Could not download ${url}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    if (!response.ok) {
      throw new CompositionValidationError(`Could not download ${url}: HTTP ${response.status}`);
    }
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > MAX_REMOTE_IMAGE_BYTES) {
      throw new CompositionValidationError(`${url} is larger than 15MB`);
    }

    try {
      const png = await sharp(body)
        .resize({ width: 2160, height: 2160, fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer();
      return `data:image/png;base64,${png.toString('base64')}`;
    } catch {
      throw new CompositionValidationError(`${url} is not a supported image`);
    }
  }

  private async brand(body: CreateCompositionDto): Promise<CompositionBrand> {
    const { logoUrl, ...rest } = body.brand || {};
    return {
      ...DEFAULT_BRAND,
      ...Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined)),
      ...(logoUrl ? { logo: await this.remoteImage(logoUrl) } : {}),
    };
  }

  private async background(
    organization: Organization,
    background: NonNullable<CreateCompositionDto['slides']>[number]['background']
  ): Promise<string | undefined> {
    if (!background) {
      return undefined;
    }
    if (background.type === 'url') {
      return this.remoteImage(background.url as string);
    }
    const b64 = await this._mediaService.generateImage(
      background.prompt as string,
      organization,
      false,
      true
    );
    if (!b64) {
      throw new Error('The image generator returned no image');
    }
    return `data:image/png;base64,${b64}`;
  }

  async renderMedia(id: string): Promise<CompositionMedia[]> {
    const composition = await this.loadForProcessing(id);
    const slides = composition.body.slides || [];
    if (composition.media.length || !slides.length) {
      return composition.media;
    }

    await this._compositionRepository.updateComposition(id, { status: 'rendering' });
    const brand = await this.brand(composition.body);
    const size = SIZES[composition.body.size || 'portrait'];
    const renderer = new ChromiumSlideRenderer({
      executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
    });

    const media: CompositionMedia[] = [];
    try {
      for (const [index, slide] of slides.entries()) {
        const html = buildSlideHtml({
          slide,
          index,
          total: slides.length,
          size,
          brand,
          backgroundImage: await this.background(composition.organization, slide.background),
        });
        const png = await renderer.render(html, size);
        const path = await this._storage.uploadSimple(
          `data:image/png;base64,${png.toString('base64')}`
        );
        const saved = await this._mediaService.saveFile(
          composition.organizationId,
          path.split('/').pop() as string,
          path
        );
        media.push({ id: saved.id, path: saved.path });
      }
    } finally {
      await renderer.close();
    }

    await this._compositionRepository.updateComposition(id, {
      media: JSON.stringify(media),
    });
    return media;
  }

  async schedule(id: string): Promise<CompositionPost[]> {
    const composition = await this.loadForProcessing(id);
    if (composition.posts.length) {
      return composition.posts;
    }

    await this._compositionRepository.updateComposition(id, { status: 'scheduling' });
    const body = await this.mapPosts(composition.organizationId, {
      compositionId: id,
      date: composition.body.date,
      requiresApproval: composition.requiresApproval,
      targets: await this.resolveTargets(composition.organizationId, composition.body.targets),
      media: composition.media,
      tags: composition.body.tags,
    });

    const validation = await this._postsService.validatePosts(
      composition.organizationId,
      body.posts
    );
    const problems = validation.flatMap((item) => {
      const reason = !item.valid
        ? item.settingsError || 'invalid settings'
        : item.errors !== true
        ? item.errors
        : item.emptyContent
        ? 'the post is empty'
        : item.tooLong
        ? `the post is longer than ${item.maximumCharacters} characters`
        : '';
      return reason ? [`${item.name} (${item.identifier}): ${reason}`] : [];
    });
    if (problems.length) {
      throw new CompositionValidationError(problems.join('; '));
    }

    const posts = (await this._postsService.createPost(
      composition.organizationId,
      body,
      'API'
    )) as CompositionPost[];

    await this._compositionRepository.updateComposition(id, {
      posts: JSON.stringify(posts),
      status: composition.requiresApproval ? 'awaiting_approval' : 'scheduled',
      error: null,
    });
    return posts;
  }

  async fail(id: string, error: string) {
    await this._compositionRepository.updateComposition(id, {
      status: 'failed',
      error,
    });
  }
}
