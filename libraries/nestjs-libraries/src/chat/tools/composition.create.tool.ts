import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { Organization } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { CompositionService } from '@gitroom/nestjs-libraries/database/prisma/compositions/composition.service';
import {
  COMPOSITION_FORMATS,
  COMPOSITION_SIZES,
  CreateCompositionDto,
  SLIDE_THEMES,
} from '@gitroom/nestjs-libraries/dtos/compositions/create.composition.dto';
import {
  compositionErrors,
} from '@gitroom/nestjs-libraries/chat/tools/composition.tool.output';
import { asToolErrors } from '@gitroom/nestjs-libraries/chat/tools/tool.errors';

const validationMessages = (errors: ValidationError[]): string[] =>
  errors.flatMap((error) => [
    ...Object.values(error.constraints || {}),
    ...validationMessages(error.children || []),
  ]);

@Injectable()
export class CompositionCreateTool implements AgentToolInterface {
  constructor(private _compositionService: CompositionService) {}
  name = 'compositionCreateTool';
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'compositionCreateTool',
      mcp: {
        annotations: {
          title: 'Create Composition',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      description: `
Use this when the user wants Postiz to design the post images: a carousel (2 to 10 slides), a single image (1 slide) or a text only post, published on one or more channels at the same date.
Postiz renders the slides with the brand, saves them to the media library and creates one post per channel in the background.
Get the channel ids and their settings rules from the integrationSchema tool first, the "settings" of each target are the same settings the schedule post tool takes, as an object.
With requiresApproval the posts stay as drafts until the composition is approved (compositionApproveTool).
The result is the composition id with status "pending": follow it with compositionGetTool until it is "awaiting_approval", "scheduled" or "failed" (with the reason in "error").
Each slide background of type "ai" uses AI image credits.
If the input is refused, the result contains output.errors describing what to fix; the call can be retried with corrected parameters.
`,
      inputSchema: z.object({
        date: z.string().describe('The publish date of every post, ISO 8601 in UTC'),
        format: z
          .enum(COMPOSITION_FORMATS)
          .describe('carousel (2 to 10 slides), image (1 slide) or text (no slides)'),
        requiresApproval: z
          .boolean()
          .optional()
          .describe('Keep the posts as drafts until the composition is approved'),
        size: z
          .enum(COMPOSITION_SIZES)
          .optional()
          .describe('portrait 1080x1350 (default), square 1080x1080 or story 1080x1920'),
        brand: z
          .object({
            primaryColor: z.string().optional().describe('#RRGGBB'),
            darkColor: z.string().optional().describe('#RRGGBB'),
            lightColor: z.string().optional().describe('#RRGGBB'),
            headingFont: z.string().optional().describe('A Google Fonts family'),
            bodyFont: z.string().optional().describe('A Google Fonts family'),
            name: z.string().optional(),
            handle: z.string().optional().describe('For example @pauta'),
            logoUrl: z.string().optional().describe('Public HTTPS url of the logo'),
          })
          .optional()
          .describe('Without a brand the slides use the default purple template'),
        slides: z
          .array(
            z.object({
              kicker: z.string().optional().describe('Up to 80 characters'),
              headline: z.string().optional().describe('Up to 200 characters'),
              body: z.string().optional().describe('Up to 600 characters'),
              theme: z
                .enum(SLIDE_THEMES)
                .optional()
                .describe('Default: the cover accent, the last of 3 or more dark, the others light'),
              background: z
                .object({
                  type: z.enum(['ai', 'url']),
                  prompt: z
                    .string()
                    .optional()
                    .describe('For type ai: what the generated image shows'),
                  url: z.string().optional().describe('For type url: public HTTPS image'),
                })
                .optional(),
            })
          )
          .optional(),
        targets: z
          .array(
            z.object({
              integrationId: z.string().describe('The id of the channel'),
              content: z.string().describe('The caption, line breaks are kept'),
              comments: z
                .array(z.string())
                .optional()
                .describe('The next posts of the thread or the comments, on channels that publish them'),
              settings: z
                .record(z.string(), z.unknown())
                .optional()
                .describe('The provider settings of the channel, from the integrationSchema tool'),
            })
          )
          .describe('1 to 20 channels'),
        tags: z
          .array(z.object({ value: z.string(), label: z.string() }))
          .optional(),
      }),
      outputSchema: z.object({
        output: z.object({ id: z.string(), status: z.string() }).or(compositionErrors),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organization = JSON.parse(
          context?.requestContext?.get('organization' as never) as string
        ) as Organization;

        // the same contract as the app route: the whole body is stored on the
        // composition, so only its fields are kept
        const body = plainToInstance(CreateCompositionDto, inputData);
        const errors = validationMessages(await validate(body, { whitelist: true }));
        if (errors.length) {
          return { output: { errors: errors.join('; ') } };
        }

        try {
          const { id, status } = await this._compositionService.startComposition(
            organization,
            body
          );
          return { output: { id, status } };
        } catch (err: unknown) {
          return asToolErrors(err);
        }
      },
    });
  }
}
