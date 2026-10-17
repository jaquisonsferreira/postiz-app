import { BadRequestException, HttpException, Injectable, Logger } from '@nestjs/common';
import { Organization } from '@prisma/client';
import { randomUUID } from 'crypto';
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
  compositionGroup,
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
const MAX_REMOTE_REDIRECTS = 3;
const MAX_PAGE = 10000;

const safePage = (page: number): number => {
  const requested = Number(page);
  return Number.isFinite(requested) ? Math.min(MAX_PAGE, Math.max(0, Math.floor(requested))) : 0;
};

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

  private async availableIntegration(org: string, integrationId: string) {
    const integration = await this._integrationService.getIntegrationById(org, integrationId);
    if (!integration || integration.deletedAt || integration.disabled) {
      throw new CompositionValidationError(`Channel ${integrationId} is not available`);
    }
    return integration;
  }

  private async resolveTargets(org: string, targets: CreateCompositionDto['targets']) {
    const resolved = [];
    for (const target of targets) {
      const integration = await this.availableIntegration(org, target.integrationId);
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

  // The app shows what was sent along with the status: the slides' text and
  // each channel's caption, never the provider settings or the AI prompts
  private presentWithContent(
    composition: NonNullable<
      Awaited<ReturnType<CompositionRepository['getCompositionWithContent']>>
    >
  ) {
    const { payload, ...rest } = composition;
    const body = JSON.parse(payload) as CreateCompositionDto;
    const slides = (body.slides || []).map(({ kicker, headline, body: text, theme }) => ({
      kicker,
      headline,
      body: text,
      theme,
    }));
    const targets = body.targets.map(({ integrationId, content }) => ({ integrationId, content }));
    return {
      ...this.present(rest),
      title: slides[0]?.headline || slides[0]?.kicker || targets[0]?.content || '',
      size: body.size || 'portrait',
      slides,
      targets,
    };
  }

  async getCompositionWithContent(org: string, id: string) {
    const composition = await this._compositionRepository.getCompositionWithContent(org, id);
    if (!composition) {
      throw new HttpException('Composition not found', 404);
    }
    return this.presentWithContent(composition);
  }

  async getCompositionsWithContent(org: string, page: number, status?: string) {
    return (
      await this._compositionRepository.getCompositionsWithContent(org, safePage(page), status)
    ).map((c) => this.presentWithContent(c));
  }

  async countCompositions(org: string, status?: string) {
    return { total: await this._compositionRepository.countCompositions(org, status) };
  }

  async getCompositions(org: string, page: number) {
    return (await this._compositionRepository.getCompositions(org, safePage(page))).map((c) =>
      this.present(c)
    );
  }

  // The same provider checks as the scheduling, run on the posts as they are
  // stored: the dashboard saves a draft without them
  private async assertValid(
    organizationId: string,
    posts: Parameters<PostsService['validatePosts']>[1]
  ) {
    const validation = await this._postsService.validatePosts(organizationId, posts);
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
  }

  async approveComposition(org: string, id: string) {
    const composition = await this.getComposition(org, id);
    const stored = [];
    for (const post of composition.posts) {
      const [root, ...thread] = await this._postsService.getPostsRecursively(
        post.postId,
        false,
        org,
        true
      );
      if (!root || root.deletedAt) {
        throw new HttpException(
          `The post for channel ${post.integration} was deleted, delete the composition and send it again`,
          400
        );
      }
      stored.push({
        integration: { id: root.integrationId },
        settings: JSON.parse(root.settings || '{}'),
        value: [root, ...thread].map((item) => ({
          content: item.content,
          image: JSON.parse(item.image || '[]'),
        })),
      });
    }
    try {
      // a channel disabled or removed while the composition waited is not
      // queued: its drafts stay for the user to move to another channel
      for (const post of stored) {
        await this.availableIntegration(org, post.integration.id);
      }
      await this.assertValid(org, stored);
    } catch (err: unknown) {
      if (err instanceof CompositionValidationError) {
        throw new HttpException(err.message, 400);
      }
      throw err;
    }
    const claimed = await this._compositionRepository.claimApproval(org, id);
    if (!claimed.count) {
      throw new HttpException(
        `Only a composition awaiting approval can be approved, this one is ${composition.status}`,
        400
      );
    }

    await this.queuePosts(org, composition.posts);
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

  // Every channel's posts carry the channel's group, so this also finds a post
  // whose creation was never saved on the composition
  private async deleteChannelPosts(org: string, id: string, targets: number) {
    for (let target = 0; target < targets; target++) {
      await this._postsService.deletePost(org, compositionGroup(id, target));
    }
  }

  async deleteComposition(org: string, id: string) {
    const composition = await this._compositionRepository.getCompositionById(id);
    if (!composition || composition.organizationId !== org) {
      throw new HttpException('Composition not found', 404);
    }
    const targets = (JSON.parse(composition.payload) as CreateCompositionDto).targets.length;

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

    // Marked deleted first: a scheduling still running in the worker either
    // created its post before this point, and its group is removed here, or
    // its save is refused and it removes the post itself
    // an edited draft keeps its id but not its group, so both are removed
    await this._compositionRepository.deleteComposition(org, id);
    await this.deletePosts(
      org,
      parseList<CompositionPost>(composition.posts).map((post) => post.postId)
    );
    await this.deleteChannelPosts(org, id, targets);
    return { id };
  }

  private async loadForProcessing(id: string) {
    const composition = await this._compositionRepository.getCompositionById(id);
    if (!composition) {
      throw new CompositionValidationError('The composition was deleted');
    }
    return {
      ...composition,
      storedMedia: composition.media,
      storedPosts: composition.posts,
      body: JSON.parse(composition.payload) as CreateCompositionDto,
      media: parseList<CompositionMedia>(composition.media),
      posts: parseList<CompositionPost>(composition.posts),
    };
  }

  private async fetchSafely(url: string, redirects = 0): Promise<globalThis.Response> {
    // the dispatcher pins what DNS answers, but Node never asks DNS for an
    // address written as an IP, so every address, redirects included, is
    // checked before it is fetched
    if (process.env.DISABLE_SSRF_PROTECTION !== 'true' && !(await isSafePublicHttpsUrl(url))) {
      throw new CompositionValidationError(`Could not download ${url}: blocked address`);
    }
    let response: globalThis.Response;
    try {
      response = await fetch(url, {
        // @ts-ignore — undici option, not in lib.dom fetch types
        dispatcher: getSsrfSafeDispatcher(),
        redirect: 'manual',
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
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel();
      if (redirects >= MAX_REMOTE_REDIRECTS) {
        throw new CompositionValidationError(`Could not download ${url}: too many redirects`);
      }
      return this.fetchSafely(new URL(location, url).toString(), redirects + 1);
    }
    return response;
  }

  // An answer that can't change (blocked address, 4xx, too large, not an image)
  // stops the composition; a timeout, a 5xx or a 429 is left to the retries
  private async remoteImage(url: string): Promise<string> {
    const response = await this.fetchSafely(url);
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

    const claimed = await this._compositionRepository.claimRendering(id);
    if (!claimed.count) {
      throw new CompositionValidationError(
        'The composition was deleted, failed or rendered by another attempt'
      );
    }
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
          const previous = media.length ? JSON.stringify(media) : composition.storedMedia;
          media.push({ id: saved.id, path: saved.path });
          const written = await this._compositionRepository.saveMedia(
            id,
            previous,
            JSON.stringify(media)
          );
          // another attempt saved this slide first: the retry starts again from
          // the stored checkpoint, and stops there if the composition is gone
          if (!written.count) {
            throw new Error(`Composition ${id} was changed by another render attempt`);
          }
          await ioRedis.del(backgroundKey(id, index));
        }
      } finally {
        await renderer.close();
      }
    });

    return media;
  }

  // changePostStatus swallows a failed workflow start, which would leave a
  // queued post that nothing publishes, so the workflow is looked up after it
  private async publishingStarted(postId: string): Promise<boolean> {
    try {
      const handle = await this._temporalService.client.getWorkflowHandle(`post_${postId}`);
      const { status } = await handle.describe();
      return status.name === 'RUNNING' || status.name === 'COMPLETED';
    } catch (err: unknown) {
      this._logger.warn(
        `No publishing workflow for post ${postId}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      return false;
    }
  }

  // Every draft is queued before any of them is checked, so one channel whose
  // workflow did not start never holds the others back. Only drafts are
  // queued: a retry that runs after a post was published never queues it again.
  // changePostStatus queues the first post of a thread; the rest is published
  // from it, so its posts only follow the state
  private async queuePosts(
    organizationId: string,
    posts: CompositionPost[],
    hold: () => Promise<void> = async () => undefined
  ) {
    const started: CompositionPost[] = [];
    for (const post of posts) {
      await hold();
      const existing = await this._postsService.getPostById(post.postId, organizationId);
      if (!existing || existing.deletedAt) {
        throw new CompositionValidationError(
          `The post for channel ${post.integration} was deleted, delete the composition and send it again`
        );
      }
      if (existing.state !== 'DRAFT') {
        continue;
      }
      await this._postsService.changePostStatus(organizationId, post.postId, 'schedule');
      const [, ...thread] = await this._postsService.getPostsRecursively(
        post.postId,
        false,
        organizationId,
        true
      );
      for (const reply of thread) {
        await this._postsService.changeState(reply.id, 'QUEUE');
      }
      started.push(post);
    }

    const missing: CompositionPost[] = [];
    for (const post of started) {
      if (!(await this.publishingStarted(post.postId))) {
        await this._postsService.changeState(post.postId, 'DRAFT');
        missing.push(post);
      }
    }
    if (missing.length) {
      throw new Error(
        `The publishing could not be started for channels ${missing
          .map((post) => post.integration)
          .join(', ')}`
      );
    }
  }

  // Every channel is created as a draft and only queued once all of them
  // exist, so a composition that fails while creating them publishes nothing.
  // The step is repeatable: a retry that finds every post saved finishes here
  private async finishScheduling(
    id: string,
    organizationId: string,
    requiresApproval: boolean,
    posts: CompositionPost[]
  ) {
    // claimed only from a processing state: an attempt that timed out and
    // resumes after a retry finished, an approval or a failure claims nothing,
    // and one that finds another attempt queueing waits for it
    const lease = randomUUID();
    if (!(await this._compositionRepository.claimQueueing(id, lease)).count) {
      const current = await this._compositionRepository.getCompositionById(id);
      if (current?.status === 'queueing') {
        throw new Error(`Composition ${id} is being queued by another attempt`);
      }
      return;
    }
    if (!requiresApproval) {
      // the lease is renewed before each post, so a retry never takes over
      // while this attempt is still starting publishing workflows
      await this.queuePosts(organizationId, posts, async () => {
        if (!(await this._compositionRepository.holdQueueing(id, lease)).count) {
          throw new Error(`Composition ${id} was changed by another attempt`);
        }
      });
    }
    const finished = await this._compositionRepository.finishQueueing(
      id,
      lease,
      requiresApproval ? 'awaiting_approval' : 'scheduled'
    );
    if (!finished.count) {
      throw new Error(`Composition ${id} was changed by another attempt`);
    }
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

    const lease = randomUUID();
    if (!(await this._compositionRepository.claimScheduling(id, lease)).count) {
      const current = await this._compositionRepository.getCompositionById(id);
      if (current?.status === 'scheduling') {
        throw new Error(`Composition ${id} is being scheduled by another attempt`);
      }
      return composition.posts;
    }
    const body = await this.mapPosts(composition.organizationId, {
      compositionId: id,
      date: composition.body.date,
      requiresApproval: true,
      targets: await this.resolveTargets(composition.organizationId, composition.body.targets),
      media: composition.media,
      tags: composition.body.tags,
    });

    await this.assertValid(composition.organizationId, body.posts);

    // One channel at a time, each post saved on the record as soon as it
    // exists, so a retry skips the channels already saved. The lease is renewed
    // before each channel: an attempt that lost it stops before touching one
    const posts = [...composition.posts];
    let previous = composition.storedPosts;
    for (const [target, post] of body.posts.entries()) {
      if (posts.some((saved) => saved.target === target)) {
        continue;
      }
      if (!(await this._compositionRepository.holdScheduling(id, lease, previous)).count) {
        throw new Error(`Composition ${id} was changed by another attempt`);
      }
      // a post an earlier attempt created without saving it is a draft in this
      // channel's group: it is removed so the retry leaves a single post
      await this._postsService.deletePost(composition.organizationId, compositionGroup(id, target));
      const [created] = (await this._postsService.createPost(
        composition.organizationId,
        { ...body, posts: [post] },
        'API',
        true
      )) as Omit<CompositionPost, 'target'>[];
      posts.push({ ...created, target });

      const next = JSON.stringify(posts);
      const written = await this._compositionRepository.savePosts(id, lease, previous, next);
      if (!written.count) {
        // the lease moved to another attempt while this post was created, so
        // the channel's group may already hold that attempt's saved post: the
        // draft is left in the group, which the composition's deletion removes
        this._logger.warn(
          `Composition ${id} lost its scheduling lease, draft ${created.postId} was left unsaved`
        );
        throw new Error(`Composition ${id} was changed by another attempt`);
      }
      previous = next;
    }

    await this.finishScheduling(
      id,
      composition.organizationId,
      composition.requiresApproval,
      posts
    );
    return posts;
  }

  // The drafts of a failed composition are removed. A channel already queued
  // stays: its publishing workflow may have published it already, and the
  // error says which channels those are
  async fail(id: string, error: string) {
    const composition = await this._compositionRepository.getCompositionById(id);
    if (!composition) {
      return;
    }
    // marked failed before the cleanup: a scheduling attempt still running can
    // no longer save or queue a post once the cleanup has started
    await this._compositionRepository.markFailed(id, error);
    const targets = (JSON.parse(composition.payload) as CreateCompositionDto).targets.length;
    const queued: string[] = [];
    for (let target = 0; target < targets; target++) {
      const saved = parseList<CompositionPost>(composition.posts).find((post) => post.target === target);
      const existing = saved
        ? await this._postsService.getPostById(saved.postId, composition.organizationId)
        : null;
      if (existing && !existing.deletedAt && existing.state !== 'DRAFT') {
        queued.push(saved!.integration);
        continue;
      }
      if (existing && !existing.deletedAt) {
        await this._postsService.deletePost(composition.organizationId, existing.group);
      }
      await this._postsService.deletePost(composition.organizationId, compositionGroup(id, target));
    }
    if (queued.length) {
      await this._compositionRepository.markFailed(
        id,
        `${error}. Already queued and kept: ${queued.join(', ')}`
      );
    }
  }
}
