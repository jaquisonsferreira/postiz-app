import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { AdsBoostService } from '@gitroom/nestjs-libraries/database/prisma/ads/ads.boost.service';
import { asToolErrors } from '@gitroom/nestjs-libraries/chat/tools/tool.errors';

@Injectable()
export class AdsBoostPostTool implements AgentToolInterface {
  constructor(private _boostService: AdsBoostService) {}
  name = 'adsBoostPostTool';
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'adsBoostPostTool',
      mcp: {
        annotations: {
          title: 'Boost Post',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      description: `
Propose a paid boost of a published post. It never spends money by itself: the boost waits in the Approvals page until a person approves it, then the campaign is created on the platform.
Call adsBoostOptionsTool first to pick an account that accepts the post, and use only the objectives and budget types it lists.
Money is in cents of the account currency. A daily budget is spent every day for "days" days, a lifetime budget is the total for the whole period.
Start small (a daily budget the user agrees with, for 3 to 7 days), use "engagement" for posts that should get reactions, "reach" to be seen by more people and "traffic" for clicks to a landing page.
Tell the user the total it may spend and share approvalUrl so they can approve it.
`,
      inputSchema: z.object({
        postId: z.string(),
        adAccountId: z.string(),
        objective: z.enum(['engagement', 'reach', 'traffic']),
        budgetType: z.enum(['daily', 'lifetime']),
        budgetAmount: z.number().int().positive().describe('Cents of the account currency'),
        days: z.number().int().min(1).max(90),
        audience: z.object({
          countries: z.array(z.string().regex(/^[A-Z]{2}$/)).describe('ISO codes, like BR'),
          ageMin: z.number().int().min(13).max(65),
          ageMax: z.number().int().min(13).max(65),
        }),
        destinationUrl: z.string().url().optional().describe('Needed by Google Ads'),
        texts: z
          .object({
            headline: z.string().max(40),
            longHeadline: z.string().max(90),
            description: z.string().max(90),
            businessName: z.string().max(25),
          })
          .optional()
          .describe('Needed by Google Ads'),
      }),
      outputSchema: z.object({
        output: z
          .object({ id: z.string(), status: z.string(), approvalUrl: z.string() })
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          context?.requestContext?.get('organization' as never) as string
        ).id;

        try {
          const boost = await this._boostService.create(organizationId, inputData, 'agent');
          return {
            output: {
              id: boost.id,
              status: boost.status,
              approvalUrl: `${process.env.FRONTEND_URL}/approvals`,
            },
          };
        } catch (err: unknown) {
          return asToolErrors(err);
        }
      },
    });
  }
}
