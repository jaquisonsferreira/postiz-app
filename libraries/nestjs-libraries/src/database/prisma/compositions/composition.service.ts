import { BadRequestException, HttpException, Injectable, Logger } from '@nestjs/common';
import { Organization } from '@prisma/client';
import { randomUUID } from 'crypto';
import { TypedSearchAttributes, WorkflowNotFoundError } from '@temporalio/common';
import { TemporalService } from 'nestjs-temporal-core';
import sharp from 'sharp';
import dayjs from 'dayjs';
import { CompositionRepository } from '@gitroom/nestjs-libraries/database/prisma/compositions/composition.repository';
import { CreateCompositionDto } from '@gitroom/nestjs-libraries/dtos/compositions/create.composition.dto';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { organizationId } from '@gitroom/nestjs-libraries/temporal/temporal.search.attribute';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { getSsrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { checkPublicHttpsUrl } from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator';
import { ChromiumSlideRenderer } from '@gitroom/nestjs-libraries/compositions/chromium.slide.renderer';
import {
  buildSlideHtml,
  SLIDE_SIZES,
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

const SIZES: Record<NonNullable<CreateCompositionDto['size']>, SlideSize> = SLIDE_SIZES;

const MAX_REMOTE_IMAGE_BYTES = 15 * 1024 * 1024;
const REMOTE_IMAGE_TIMEOUT_MS = 30000;
const MAX_REMOTE_REDIRECTS = 3;
const MAX_PAGE = 10000;

const safePage = (page: number): number => {
  const requested = Number(page);
  return Number.isFinite(requested) ? Math.min(MAX_PAGE, Math.max(0, Math.floor(requested))) : 0;
};
// The posts queue lock is renewed before each channel, so it only has to
// outlive the slowest channel. The credits lock covers one AI generation, and
// a render waits for it instead of failing an attempt
const POSTS_QUEUE_LOCK_SECONDS = 2 * 60;
const AI_CREDITS_LOCK_SECONDS = 5 * 60;
const AI_CREDITS_WAIT_MS = 5 * 60 * 1000;
const LOCK_RETRY_MS = 1000;
const postsQueueKey = (organizationId: string): string =>
  `composition:posts-queue:${organizationId}`;
const aiCreditsKey = (organizationId: string): string =>
  `composition:ai-credits:${organizationId}`;
// The holder is compared and the lock changed in one step, so a lock that
// expired and was taken by another composition is never renewed or deleted
const RENEW_LOCK = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('expire', KEYS[1], ARGV[2]) end return 0`;
const RELEASE_LOCK = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0`;

const POSTS_LIMIT_MESSAGE =
  'You have reached the maximum number of posts for your subscription. Please upgrade your subscription to add more posts.';

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
    private _temporalService: TemporalService,
    private _integrationManager: IntegrationManager
  ) {}

  // Same rule as the media routes: credits only count where billing is on
  private async hasImageCredits(org: Organization, needed: number): Promise<boolean> {
    if (!needed || !process.env.STRIPE_PUBLISHABLE_KEY) {
      return true;
    }
    return (await this._subscriptionService.checkCredits(org)).credits >= needed;
  }

  // The drafts a composition queues count against the plan's posts of the
  // month the way the posts routes count them, from the day the subscription's
  // month started. Without a subscription the plan is FREE
  private async hasPostsLeft(organizationId: string, posts: CompositionPost[]): Promise<boolean> {
    if (!process.env.STRIPE_PUBLISHABLE_KEY) {
      return true;
    }
    let needed = 0;
    for (const post of posts) {
      const [root, ...thread] = await this._postsService.getPostsRecursively(
        post.postId,
        false,
        organizationId,
        true
      );
      // a reply an attempt that stopped already queued is counted in the
      // posts of the month, so only what is still a draft is added
      if (root && !root.deletedAt && root.state === 'DRAFT') {
        needed += [root, ...thread].filter(
          (member) => !member.deletedAt && member.state === 'DRAFT'
        ).length;
      }
    }
    if (!needed) {
      return true;
    }
    const subscription = await this._subscriptionService.getSubscription(organizationId);
    const limit = pricing[subscription?.subscriptionTier || 'FREE'].posts_per_month;
    if (!subscription) {
      return needed <= limit;
    }
    const months = Math.abs(dayjs(subscription.createdAt).diff(dayjs(), 'month'));
    const used = await this._postsService.countPostsFromDay(
      organizationId,
      dayjs(subscription.createdAt).add(months, 'month').toDate()
    );
    return used + needed <= limit;
  }

  // What an organization counts and then spends (its posts of the month, its
  // AI credits) is done by one composition at a time, so two of them never
  // both take the last one. Only billing limits them, so without it nothing
  // waits. The lock is renewed and released only by its holder: one that
  // expired and was taken by another stops the holder at its next renewal
  private async withBillingLock<T>(
    key: string,
    lock: { seconds: number; waitMs: number; busy: () => Error },
    run: (renew: () => Promise<void>) => Promise<T>
  ): Promise<T> {
    if (!process.env.STRIPE_PUBLISHABLE_KEY) {
      return run(async () => undefined);
    }
    const token = randomUUID();
    const deadline = Date.now() + lock.waitMs;
    while (!(await ioRedis.set(key, token, 'EX', lock.seconds, 'NX'))) {
      if (Date.now() >= deadline) {
        throw lock.busy();
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
    }
    try {
      return await run(async () => {
        if (!(await ioRedis.eval(RENEW_LOCK, 1, key, token, lock.seconds))) {
          throw new Error(`The lock ${key} was taken by another composition`);
        }
      });
    } finally {
      await ioRedis.eval(RELEASE_LOCK, 1, key, token);
    }
  }

  // The draft as it is stored now, in the shape the provider checks read
  private async storedDraft(org: string, post: CompositionPost) {
    const [root, ...thread] = await this._postsService.getPostsRecursively(
      post.postId,
      false,
      org,
      true
    );
    if (!root || root.deletedAt) {
      throw new CompositionValidationError(
        `The post for channel ${post.integration} was deleted, delete the composition and send it again`
      );
    }
    return {
      state: root.state,
      post: {
        integration: { id: root.integrationId },
        settings: JSON.parse(root.settings || '{}'),
        value: [root, ...thread].map((item) => ({
          content: item.content,
          image: JSON.parse(item.image || '[]'),
        })),
      },
    };
  }

  // a channel disabled or removed while the composition waited is not
  // queued: its drafts stay for the user to move to another channel
  private async assertPublishable(
    org: string,
    drafts: Awaited<ReturnType<CompositionService['storedDraft']>>['post'][]
  ) {
    for (const draft of drafts) {
      this.assertComments(
        await this.availableIntegration(org, draft.integration.id),
        draft.value.length > 1
      );
    }
    await this.assertValid(org, drafts);
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

  // the comments are published by the provider after the post, so a channel
  // without comments would publish the post and drop them
  private assertComments(
    integration: { id: string; providerIdentifier: string },
    hasComments: boolean
  ) {
    if (
      hasComments &&
      !this._integrationManager.getSocialIntegration(integration.providerIdentifier).comment
    ) {
      throw new CompositionValidationError(
        `Channel ${integration.id} (${integration.providerIdentifier}) does not publish comments, remove its comments`
      );
    }
  }

  private async resolveTargets(org: string, targets: CreateCompositionDto['targets']) {
    const resolved = [];
    for (const target of targets) {
      const integration = await this.availableIntegration(org, target.integrationId);
      this.assertComments(integration, !!target.comments?.length);
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
    try {
      const stored = [];
      for (const post of composition.posts) {
        stored.push((await this.storedDraft(org, post)).post);
      }
      await this.assertPublishable(org, stored);
    } catch (err: unknown) {
      if (err instanceof CompositionValidationError) {
        throw new HttpException(err.message, 400);
      }
      throw err;
    }
    await this.withBillingLock(
      postsQueueKey(org),
      {
        seconds: POSTS_QUEUE_LOCK_SECONDS,
        waitMs: 0,
        busy: () =>
          new HttpException(
            'Another composition of this organization is being queued, send the approval again',
            409
          ),
      },
      async (renew) => {
        if (!(await this.hasPostsLeft(org, composition.posts))) {
          throw new HttpException(POSTS_LIMIT_MESSAGE, 402);
        }
        const lease = randomUUID();
        const claimed = await this._compositionRepository.claimApproval(org, id, lease);
        if (!claimed.count) {
          throw new HttpException(
            `Only a composition awaiting approval can be approved, this one is ${composition.status}`,
            400
          );
        }

        // the lease is renewed before each post, so an approval sent again while
        // this one is still starting publishing workflows waits for it. Each
        // draft is checked again right before it is queued, so one edited in
        // the dashboard while the approval runs is never queued unchecked. A
        // draft moved to another channel there is saved with that channel
        const posts = composition.posts.map((post) => ({ ...post }));
        try {
          await this.queuePosts(org, posts, async (post) => {
            if (!(await this._compositionRepository.holdApproval(id, lease)).count) {
              throw new HttpException(`Composition ${id} is being approved by another request`, 409);
            }
            await renew();
            const draft = await this.storedDraft(org, post);
            post.integration = draft.post.integration.id;
            if (draft.state === 'DRAFT') {
              await this.assertPublishable(org, [draft.post]);
            }
          });
        } catch (err: unknown) {
          if (err instanceof CompositionValidationError) {
            await this._compositionRepository.releaseApproval(id, lease);
            throw new HttpException(err.message, 400);
          }
          throw err;
        }
        if (
          !(await this._compositionRepository.finishApproval(id, lease, JSON.stringify(posts)))
            .count
        ) {
          throw new HttpException(`Composition ${id} is being approved by another request`, 409);
        }
      }
    );

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

  // Repeatable: a deletion that stopped after marking the composition deleted
  // removes the posts that were left when it is sent again
  async deleteComposition(org: string, id: string) {
    const composition = await this._compositionRepository.getCompositionForDeletion(org, id);
    if (!composition) {
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
    // checked before it is fetched. A lookup that failed may work on a retry
    if (process.env.DISABLE_SSRF_PROTECTION !== 'true') {
      const check = await checkPublicHttpsUrl(url);
      if (check === 'unresolved') {
        throw new Error(`Could not download ${url}: the address could not be resolved`);
      }
      if (check === 'blocked') {
        throw new CompositionValidationError(`Could not download ${url}: blocked address`);
      }
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
    size: SlideSize,
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
    // looked up again and saved while the lock is held: another attempt that
    // generated this slide while this one waited is reused, not paid twice
    return this.withBillingLock(
      aiCreditsKey(organization.id),
      {
        seconds: AI_CREDITS_LOCK_SECONDS,
        waitMs: AI_CREDITS_WAIT_MS,
        busy: () =>
          new Error(`Composition ${id} waits for the AI credits of its organization`),
      },
      async () => {
        const generated = await ioRedis.get(backgroundKey(id, index));
        if (generated) {
          return generated;
        }
        if (!(await this.hasImageCredits(organization, 1))) {
          throw new CompositionValidationError('Not enough AI image credits for the backgrounds');
        }
        let b64: string | undefined;
        try {
          b64 = await this._mediaService.generateImage(
            background.prompt as string,
            organization,
            false,
            size.height > size.width
          );
        } catch (err: unknown) {
          // a refused prompt (a safety rejection) is refused again on a retry, a
          // generator that failed (5xx) may answer the next attempt
          if (err instanceof HttpException && err.getStatus() < 500 && err.getStatus() !== 429) {
            throw new CompositionValidationError(err.message);
          }
          throw err;
        }
        if (!b64) {
          throw new CompositionValidationError('The image generator returned no image');
        }
        const image = `data:image/png;base64,${b64}`;
        await ioRedis.set(backgroundKey(id, index), image, 'EX', BACKGROUND_CACHE_SECONDS);
        return image;
      }
    );
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
            size,
            slide.background
          ),
        });
        const png = await renderer.render(html, size);
        const path = await this._storage.uploadSimple(
          `data:image/png;base64,${png.toString('base64')}`
        );
        let saved: { id: string; path: string } | undefined;
        try {
          saved = await this._mediaService.saveFile(
            composition.organizationId,
            path.split('/').pop() as string,
            path
          );
          const previous = media.length ? JSON.stringify(media) : composition.storedMedia;
          const next = [...media, { id: saved.id, path: saved.path }];
          const written = await this._compositionRepository.saveMedia(
            id,
            previous,
            JSON.stringify(next)
          );
          // another attempt saved this slide first: the retry starts again from
          // the stored checkpoint, and stops there if the composition is gone
          if (!written.count) {
            throw new Error(`Composition ${id} was changed by another render attempt`);
          }
          media.push(next[next.length - 1]);
        } catch (err: unknown) {
          // a slide that is on no composition is never removed by anything else
          await this.discardSlide(composition.organizationId, path, saved?.id);
          throw err;
        }
        await ioRedis.del(backgroundKey(id, index));
      }
    } finally {
      await renderer.close();
    }

    return media;
  }

  // The cleanup of a slide that could not be saved never hides why it failed:
  // what can't be removed is logged and the caller rethrows the first error
  private async discardSlide(organizationId: string, path: string, mediaId?: string) {
    if (mediaId) {
      try {
        await this._mediaService.deleteMedia(organizationId, mediaId);
      } catch (err: unknown) {
        this._logger.warn(
          `Could not remove media ${mediaId}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
    try {
      await this._storage.removeFile(path);
    } catch (err: unknown) {
      this._logger.warn(
        `Could not remove ${path}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // changePostStatus swallows a failed workflow start, which would leave a
  // queued post that nothing publishes, so the workflow is looked up after it.
  // Only an answer that it does not exist counts: starting it again over one
  // that could not be described would restart a publishing in progress
  private async publishingStarted(postId: string): Promise<boolean> {
    try {
      const handle = await this._temporalService.client.getWorkflowHandle(`post_${postId}`);
      const { status } = await handle.describe();
      return status.name === 'RUNNING' || status.name === 'COMPLETED';
    } catch (err: unknown) {
      if (err instanceof WorkflowNotFoundError) {
        this._logger.warn(`No publishing workflow for post ${postId}: ${err.message}`);
        return false;
      }
      throw new Error(
        `The publishing of post ${postId} could not be checked: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  // Every draft is queued before any of them is checked, so one channel whose
  // workflow did not start never holds the others back. Only drafts are
  // queued: a retry that runs after a post was published never queues it again.
  // changePostStatus queues the first post of a thread; the rest is published
  // from it, so its posts only follow the state. They are queued before the
  // workflow starts: one that publishes a reply at once is never overwritten
  private async queuePosts(
    organizationId: string,
    posts: CompositionPost[],
    hold: (post: CompositionPost) => Promise<void> = async () => undefined
  ) {
    const started: { post: CompositionPost; replies: string[] }[] = [];
    for (const post of posts) {
      await hold(post);
      const existing = await this._postsService.getPostById(post.postId, organizationId);
      if (!existing || existing.deletedAt) {
        throw new CompositionValidationError(
          `The post for channel ${post.integration} was deleted, delete the composition and send it again`
        );
      }
      if (existing.state !== 'DRAFT' && existing.state !== 'QUEUE') {
        continue;
      }
      const [, ...thread] = await this._postsService.getPostsRecursively(
        post.postId,
        false,
        organizationId,
        true
      );
      // queued by an attempt that may have stopped before its workflow
      // started: it is checked with the others, and returned to draft if not
      if (existing.state === 'QUEUE') {
        started.push({ post, replies: thread.map((reply) => reply.id) });
        continue;
      }
      for (const reply of thread) {
        await this._postsService.changeState(reply.id, 'QUEUE');
      }
      await this._postsService.changePostStatus(organizationId, post.postId, 'schedule');
      started.push({ post, replies: thread.map((reply) => reply.id) });
    }

    const missing: CompositionPost[] = [];
    for (const { post, replies } of started) {
      if (!(await this.publishingStarted(post.postId))) {
        for (const id of [post.postId, ...replies]) {
          await this._postsService.changeState(id, 'DRAFT');
        }
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
  private async queueScheduling(
    id: string,
    organizationId: string,
    requiresApproval: boolean,
    posts: CompositionPost[],
    renew: () => Promise<void>
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
      if (!(await this.hasPostsLeft(organizationId, posts))) {
        throw new CompositionValidationError(POSTS_LIMIT_MESSAGE);
      }
      // the lease is renewed before each post, so a retry never takes over
      // while this attempt is still starting publishing workflows
      await this.queuePosts(organizationId, posts, async () => {
        if (!(await this._compositionRepository.holdQueueing(id, lease)).count) {
          throw new Error(`Composition ${id} was changed by another attempt`);
        }
        await renew();
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

  // Drafts that wait for an approval take no posts of the month, so only a
  // composition that queues its posts waits for the organization's queue
  private async finishScheduling(
    id: string,
    organizationId: string,
    requiresApproval: boolean,
    posts: CompositionPost[]
  ) {
    if (requiresApproval) {
      return this.queueScheduling(id, organizationId, requiresApproval, posts, async () => undefined);
    }
    return this.withBillingLock(
      postsQueueKey(organizationId),
      {
        seconds: POSTS_QUEUE_LOCK_SECONDS,
        waitMs: 0,
        busy: () =>
          new Error(
            `Composition ${id} waits for another composition of its organization to be queued`
          ),
      },
      (renew) => this.queueScheduling(id, organizationId, requiresApproval, posts, renew)
    );
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
      // the posts of a channel have fixed ids in its group, so a post an earlier
      // attempt created without saving it is updated here instead of duplicated
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
        // a composition deleted or failed while this post was created was
        // already cleaned up, so the draft is removed here
        const current = await this._compositionRepository.getCompositionById(id);
        if (!current || current.status === 'failed') {
          await this._postsService.deletePost(
            composition.organizationId,
            compositionGroup(id, target)
          );
          throw new Error(`Composition ${id} was deleted or failed while its posts were created`);
        }
        // the lease moved to another attempt while this post was created: the
        // posts have the ids that attempt saves, so they are left to it
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
    // no longer save or queue a post once the cleanup has started. One that
    // finished the scheduling first keeps it, and nothing is removed
    if (!(await this._compositionRepository.failProcessing(id, error)).count) {
      return;
    }
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
