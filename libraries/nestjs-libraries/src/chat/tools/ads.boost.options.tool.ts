import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { AdsBoostService } from '@gitroom/nestjs-libraries/database/prisma/ads/ads.boost.service';
import { asToolErrors } from '@gitroom/nestjs-libraries/chat/tools/composition.tool.output';

@Injectable()
export class AdsBoostOptionsTool implements AgentToolInterface {
  constructor(private _boostService: AdsBoostService) {}
  name = 'adsBoostOptionsTool';
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'adsBoostOptionsTool',
      mcp: {
        annotations: {
          title: 'Ad Boost Options',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      description: `
Check whether a published post can be boosted and in which ad accounts, before calling adsBoostPostTool.
Facebook and Instagram posts are boosted in Meta Ads, YouTube videos in Google Ads.
Each account lists what it accepts: the objectives, the budget types, and whether it needs a landing page and the ad texts (Google Ads does).
`,
      inputSchema: z.object({
        postId: z.string().describe('The id of a published post'),
      }),
      outputSchema: z.object({
        output: z
          .object({
            reference: z.string(),
            accounts: z.array(
              z.object({
                id: z.string(),
                name: z.string(),
                provider: z.string(),
                currency: z.string(),
                capabilities: z.object({
                  promotes: z.array(z.string()),
                  objectives: z.array(z.string()),
                  budgetTypes: z.array(z.string()),
                  needsDestinationUrl: z.boolean(),
                  needsTexts: z.boolean(),
                }),
              })
            ),
          })
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          context?.requestContext?.get('organization' as never) as string
        ).id;

        try {
          return { output: await this._boostService.options(organizationId, inputData.postId) };
        } catch (err: unknown) {
          return asToolErrors(err);
        }
      },
    });
  }
}
