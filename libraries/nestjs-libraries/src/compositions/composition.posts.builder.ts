import type { CreatePostDto } from '@gitroom/nestjs-libraries/dtos/posts/create.post.dto';
import { CompositionValidationError } from '@gitroom/nestjs-libraries/compositions/composition.errors';

export interface CompositionTarget {
  integrationId: string;
  providerIdentifier: string;
  content: string;
  comments?: string[];
  settings?: Record<string, unknown>;
}

export interface CompositionMedia {
  id: string;
  path: string;
}

export interface CompositionPostsInput {
  compositionId: string;
  date: string;
  requiresApproval: boolean;
  targets: CompositionTarget[];
  media: CompositionMedia[];
  tags?: { value: string; label: string }[];
}

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const captionToHtml = (text: string): string =>
  text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('');

export const buildCompositionPosts = (input: CompositionPostsInput): CreatePostDto => {
  if (!input.targets.length) {
    throw new CompositionValidationError('At least one channel is required');
  }

  return {
    type: input.requiresApproval ? 'draft' : 'schedule',
    date: input.date,
    shortLink: false,
    tags: input.tags || [],
    posts: input.targets.map((target, targetIndex) => ({
      integration: { id: target.integrationId },
      group: input.compositionId,
      settings: {
        ...(target.settings || {}),
        __type: target.providerIdentifier,
      } as unknown as CreatePostDto['posts'][number]['settings'],
      value: [target.content, ...(target.comments || [])].map((content, valueIndex) => ({
        id: `${input.compositionId}-${targetIndex}-${valueIndex}`,
        delay: 0,
        content: captionToHtml(content),
        image: valueIndex === 0 ? input.media.map(({ id, path }) => ({ id, path })) : [],
      })),
    })),
  };
};
