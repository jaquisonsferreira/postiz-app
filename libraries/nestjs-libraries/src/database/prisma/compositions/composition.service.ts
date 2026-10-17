import { BadRequestException, HttpException, Injectable, Logger } from '@nestjs/common';
import { Organization } from '@prisma/client';
import { TypedSearchAttributes } from '@temporalio/common';
import { TemporalService } from 'nestjs-temporal-core';
import sharp from 'sharp';
import pLimit from 'p-limit';
import { CompositionRepository } from '@gitroom/nestjs-libraries/database/prisma/compositions/composition.repository';
import { CreateCompositionDto } from '@gitroom/nestjs-libraries/dtos/compositions/create.composition.dto';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { organizationId } from '@gitroom/nestjs-libraries/temporal/temporal.search.attribute';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { getSsrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { isSafePublicHttpsUrl } from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator';
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
  | 'approving'
  | 'queueing'
  | 'scheduled'
  | 'failed';

export interface CompositionPost {
  postId: string;
  integration: string;
  target: number;
}

const SIZES: Record<NonNullable<CreateCompositionDto['size']>, SlideSize> = {
  portrait: { width: 1080, height: 1350 },
  square: { width: 1080, height: 1080 },
  story: { width: 1080, height: 1920 },
};

const MAX_REMOTE_IMAGE_BYTES = 15 * 1024 * 1024;
const REMOTE_IMAGE_TIMEOUT_MS = 30000;

// Every composition on this worker shares the limit, so a burst of carousels
// never runs more browsers than the publishing workers can live next to
const renderSlot = pLimit(Number(process.env.COMPOSITION_RENDER_CONCURRENCY) || 2);

// A generated background is kept for a day, so a retry after a failed render
// or upload reuses it instead of paying for it again
const BACKGROUND_CACHE_SECONDS = 24 * 60 * 60;
const backgroundKey = (id: string, index: number): string =>
  `composition:${id}:background:${index}`;

const aiBackgrounds = (body: CreateCompositionDto): number =>
  (body.slides || []).filter((slide) => slide.background?.type === 'ai').length;

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
    private _subscriptionService: SubscriptionService,
    private _temporalService: TemporalService
  ) {}

  // Same rule as the media routes: credits only count where billing is on
  private async hasImageCredits(org: Organization, needed: number): Promise<boolean> {
    if (!needed || !process.env.STRIPE_PUBLISHABLE_KEY) {
      return true;
    }
    return (await this._subscriptionService.checkCredits(org)).credits >= needed;
  }

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
    // the request carries only part of the subscription, and the credit period
    // starts at its creation date
    const subscription = await this._subscriptionService.getSubscriptionByOrganizationId(org.id);
    if (!(await this.hasImageCredits({ ...org, subscription } as Organization, aiBackgrounds(body)))) {
      throw new HttpException('Not enough AI image credits for the backgrounds', 402);
    }

    try {
      await this.mapPosts(org.id, {
        compositionId: 'validation',
        date: body.date,
        // drafts skip the provider settings, and every post is scheduled in the end
        requiresApproval: false,
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
    const safePage = Math.max(0, Math.floor(Number(page) || 0));
    return (await this._compositionRepository.getCompositions(org, safePage)).map((c) =>
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
      await this.queuePost(org, post.postId);
    }
    await this._compositionRepository.updateComposition(id, { status: 'scheduled' });

    return this.getComposition(org, id);
  }

  private async deletePosts(org: string, postIds: string[]) {
    for (const postId of postIds) {
      const existing = await this._postsService.getPostById(postId, org);
      if (existing && !existing.deletedAt) {
        await this._postsService.deletePost(org, existing.group);
      }
    }
  }

  async deleteComposition(org: string, id: string) {
    await this.getComposition(org, id);

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

    // Marked deleted before its posts are read: a scheduling still running in
    // the worker either saved its post before this point, and it is read here,
    // or its save is refused and it removes the post itself
    await this._compositionRepository.deleteComposition(org, id);
    const saved = await this._compositionRepository.getCompositionPosts(org, id);
    await this.deletePosts(
      org,
      parseList<CompositionPost>(saved?.posts || null).map((post) => post.postId)
    );
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

  // An answer that can't change (blocked address, 4xx, too large, not an image)
  // stops the composition; a timeout, a 5xx or a 429 is left to the retries
  private async remoteImage(url: string): Promise<string> {
    // the dispatcher pins what DNS answers, but Node never asks DNS for an
    // address written as an IP, so the address itself is checked first
    if (process.env.DISABLE_SSRF_PROTECTION !== 'true' && !(await isSafePublicHttpsUrl(url))) {
      throw new CompositionValidationError(`Could not download ${url}: blocked address`);
    }
    let response: globalThis.Response;
    try {
      response = await fetch(url, {
        // @ts-ignore — undici option, not in lib.dom fetch types
        dispatcher: getSsrfSafeDispatcher(),
        signal: AbortSignal.timeout(REMOTE_IMAGE_TIMEOUT_MS),
      });
    } catch (err: unknown) {
      const cause = (err as { cause?: unknown }).cause;
      const reason =
        cause instanceof Error ? cause.message : err instanceof Error ? err.message : String(err);
      if (reason === 'Blocked IP') {
        throw new CompositionValidationError(`Could not download ${url}: ${reason}`);
      }
      throw new Error(`Could not download ${url}: ${reason}`);
    }
    if (response.status >= 500 || response.status === 429) {
      await response.body?.cancel();
      throw new Error(`Could not download ${url}: HTTP ${response.status}`);
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new CompositionValidationError(`Could not download ${url}: HTTP ${response.status}`);
    }
    if (Number(response.headers.get('content-length')) > MAX_REMOTE_IMAGE_BYTES) {
      await response.body.cancel();
      throw new CompositionValidationError(`${url} is larger than 15MB`);
    }

    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > MAX_REMOTE_IMAGE_BYTES) {
        throw new CompositionValidationError(`${url} is larger than 15MB`);
      }
      chunks.push(Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks);

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
    id: string,
    index: number,
    organization: Organization,
    background: NonNullable<CreateCompositionDto['slides']>[number]['background']
  ): Promise<string | undefined> {
    if (!background) {
      return undefined;
    }
    if (background.type === 'url') {
      return this.remoteImage(background.url as string);
    }
    const cached = await ioRedis.get(backgroundKey(id, index));
    if (cached) {
      return cached;
    }
    if (!(await this.hasImageCredits(organization, 1))) {
      throw new CompositionValidationError('Not enough AI image credits for the backgrounds');
    }
    const b64 = await this._mediaService.generateImage(
      background.prompt as string,
      organization,
      false,
      true
    );
    if (!b64) {
      throw new CompositionValidationError('The image generator returned no image');
    }
    const image = `data:image/png;base64,${b64}`;
    await ioRedis.set(backgroundKey(id, index), image, 'EX', BACKGROUND_CACHE_SECONDS);
    return image;
  }

  // Each slide is saved as soon as it is rendered, so a retry starts at the
  // first missing slide and never pays for an AI background a second time
  async renderMedia(id: string): Promise<CompositionMedia[]> {
    const composition = await this.loadForProcessing(id);
    const slides = composition.body.slides || [];
    if (composition.media.length >= slides.length) {
      return composition.media;
    }

    await this._compositionRepository.updateComposition(id, { status: 'rendering' });
    const brand = await this.brand(composition.body);
    const size = SIZES[composition.body.size || 'portrait'];
    const media = [...composition.media];

    await renderSlot(async () => {
      const renderer = new ChromiumSlideRenderer({
        executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
      });
      try {
        for (let index = media.length; index < slides.length; index++) {
          const slide = slides[index];
          const html = buildSlideHtml({
            slide,
            index,
            total: slides.length,
            size,
            brand,
            backgroundImage: await this.background(
              id,
              index,
              composition.organization,
              slide.background
            ),
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
          const written = await this._compositionRepository.updateComposition(id, {
            media: JSON.stringify(media),
          });
          if (!written.count) {
            throw new CompositionValidationError('The composition was deleted');
          }
          await ioRedis.del(backgroundKey(id, index));
        }
      } finally {
        await renderer.close();
      }
    });

    return media;
  }

  // changePostStatus queues the first post and starts its workflow; the rest of
  // a thread is published from it, so its posts only follow the state
  // Only a draft is queued: a retry that runs after the post was published must
  // not put it back in the queue and publish it a second time
  private async queuePost(organizationId: string, postId: string) {
    const post = await this._postsService.getPostById(postId, organizationId);
    if (!post || post.deletedAt || post.state !== 'DRAFT') {
      return;
    }
    await this._postsService.changePostStatus(organizationId, postId, 'schedule');
    const [, ...thread] = await this._postsService.getPostsRecursively(
      postId,
      false,
      organizationId,
      true
    );
    for (const post of thread) {
      await this._postsService.changeState(post.id, 'QUEUE');
    }
  }

  // Every channel is created as a draft and only queued once all of them
  // exist, so a composition that fails halfway never publishes a part of it.
  // The step is repeatable: a retry that finds every post saved finishes here
  private async finishScheduling(
    id: string,
    organizationId: string,
    requiresApproval: boolean,
    posts: CompositionPost[]
  ) {
    // claimed first: an attempt that timed out and was failed meanwhile finds
    // the composition failed here and queues nothing
    const claimed = await this._compositionRepository.updateComposition(id, {
      status: 'queueing',
    });
    if (!claimed.count) {
      throw new CompositionValidationError('The composition failed or was deleted');
    }
    if (!requiresApproval) {
      for (const post of posts) {
        await this.queuePost(organizationId, post.postId);
      }
    }
    await this._compositionRepository.updateComposition(id, {
      status: requiresApproval ? 'awaiting_approval' : 'scheduled',
      error: null,
    });
  }

  async schedule(id: string): Promise<CompositionPost[]> {
    const composition = await this.loadForProcessing(id);
    if (composition.posts.length >= composition.body.targets.length) {
      await this.finishScheduling(
        id,
        composition.organizationId,
        composition.requiresApproval,
        composition.posts
      );
      return composition.posts;
    }

    await this._compositionRepository.updateComposition(id, { status: 'scheduling' });
    const body = await this.mapPosts(composition.organizationId, {
      compositionId: id,
      date: composition.body.date,
      requiresApproval: true,
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

    // One channel at a time, each post saved on the record as soon as it
    // exists: the repository gives a new post a new id, so a retry skips the
    // channels already saved instead of creating them twice
    const posts = [...composition.posts];
    for (const [target, post] of body.posts.entries()) {
      if (posts.some((saved) => saved.target === target)) {
        continue;
      }
      const [created] = (await this._postsService.createPost(
        composition.organizationId,
        { ...body, posts: [post] },
        'API'
      )) as Omit<CompositionPost, 'target'>[];
      posts.push({ ...created, target });

      const written = await this._compositionRepository.updateComposition(id, {
        posts: JSON.stringify(posts),
      });
      // deleted or failed while the post was being created: it must not stay
      if (!written.count) {
        await this.deletePosts(composition.organizationId, [created.postId]);
        throw new CompositionValidationError('The composition failed or was deleted');
      }
    }

    await this.finishScheduling(
      id,
      composition.organizationId,
      composition.requiresApproval,
      posts
    );
    return posts;
  }

  // A failed composition publishes nothing: the posts it already created go too
  async fail(id: string, error: string) {
    const composition = await this._compositionRepository.getCompositionById(id);
    if (!composition) {
      return;
    }
    await this._compositionRepository.markFailed(id, error);
    await this.deletePosts(
      composition.organizationId,
      parseList<CompositionPost>(composition.posts).map((post) => post.postId)
    );
  }
}
