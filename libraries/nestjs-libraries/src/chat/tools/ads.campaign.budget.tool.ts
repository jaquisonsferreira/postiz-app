import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { AdsService } from '@gitroom/nestjs-libraries/database/prisma/ads/ads.service';
import { asToolErrors } from '@gitroom/nestjs-libraries/chat/tools/composition.tool.output';
import { adsCampaignOutput } from '@gitroom/nestjs-libraries/chat/tools/ads.campaign.status.tool';

@Injectable()
export class AdsCampaignBudgetTool implements AgentToolInterface {
  constructor(private _adsService: AdsService) {}
  name = 'adsCampaignBudgetTool';
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'adsCampaignBudgetTool',
      mcp: {
        annotations: {
          title: 'Change Ad Campaign Budget',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      description: `
Change the budget of an ad campaign on its platform, keeping its type (daily or lifetime). Take the campaign id from adsCampaignsReportTool.
The amount is in cents of the account currency. Change it in steps of at most 20% so the platform keeps learning, and get the user's confirmation of the new amount first.
`,
      inputSchema: z.object({
        campaignId: z.string(),
        amount: z.number().int().positive().describe('The new budget in cents'),
      }),
      outputSchema: z.object({ output: adsCampaignOutput }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          context?.requestContext?.get('organization' as never) as string
        ).id;

        try {
          return {
            output: await this._adsService.updateCampaignBudget(
              organizationId,
              inputData.campaignId,
              inputData.amount
            ),
          };
        } catch (err: unknown) {
          return asToolErrors(err);
        }
      },
    });
  }
}
