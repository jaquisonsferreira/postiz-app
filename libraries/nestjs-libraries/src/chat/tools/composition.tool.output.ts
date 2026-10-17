import { HttpException } from '@nestjs/common';
import { z } from 'zod';
import type { CompositionMedia } from '@gitroom/nestjs-libraries/compositions/composition.posts.builder';
import type { CompositionPost } from '@gitroom/nestjs-libraries/database/prisma/compositions/composition.service';

export const compositionOutput = z.object({
  id: z.string(),
  status: z
    .string()
    .describe(
      'pending, rendering, scheduling, awaiting_approval, approving, queueing, scheduled or failed'
    ),
  format: z.string(),
  publishDate: z.string().describe('UTC time'),
  requiresApproval: z.boolean(),
  error: z.string().nullable().describe('Why the composition failed, null otherwise'),
  media: z.array(z.object({ id: z.string(), path: z.string() })),
  posts: z.array(
    z.object({
      postId: z.string(),
      integration: z.string().describe('The channel id'),
      target: z.number(),
      previewUrl: z
        .string()
        .describe('Public preview page of the created post, share it with the user'),
    })
  ),
  createdAt: z.string(),
  updatedAt: z.string(),
  title: z.string().optional(),
  size: z.string().optional(),
  slides: z
    .array(
      z.object({
        kicker: z.string().optional(),
        headline: z.string().optional(),
        body: z.string().optional(),
        theme: z.string().optional(),
      })
    )
    .optional(),
  targets: z
    .array(z.object({ integrationId: z.string(), content: z.string() }))
    .optional(),
});

export const compositionErrors = z.object({ errors: z.string() });

interface StoredComposition {
  publishDate: Date;
  createdAt: Date;
  updatedAt: Date;
  media: CompositionMedia[];
  posts: CompositionPost[];
}

export const presentComposition = <T extends StoredComposition>(composition: T) => ({
  ...composition,
  publishDate: composition.publishDate.toISOString(),
  createdAt: composition.createdAt.toISOString(),
  updatedAt: composition.updatedAt.toISOString(),
  posts: composition.posts.map((post) => ({
    ...post,
    previewUrl: `${process.env.FRONTEND_URL}/p/${post.postId}?share=true`,
  })),
});

// The service refuses with the HTTP status the app shows; a tool answers the
// same refusal as output.errors, so the client can fix the call and retry
export const asToolErrors = (err: unknown) => {
  if (err instanceof HttpException) {
    return { output: { errors: err.message } };
  }
  throw err;
};
