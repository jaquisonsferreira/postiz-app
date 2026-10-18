import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { AdsService } from '@gitroom/nestjs-libraries/database/prisma/ads/ads.service';
import { asToolErrors } from '@gitroom/nestjs-libraries/chat/tools/composition.tool.output';

export const adsCampaignOutput = z
  .object({ id: z.string(), status: z.string(), budgetAmount: z.number().nullable() })
  .or(z.object({ errors: z.string() }));

@Injectable()
export class AdsCampaignStatusTool implements AgentToolInterface {
  constructor(private _adsService: AdsService) {}
  name = 'adsCampaignStatusTool';
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'adsCampaignStatusTool',
      mcp: {
        annotations: {
          title: 'Pause or Resume Ad Campaign',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      description: `
Pause or resume an ad campaign on its platform. Take the campaign id from adsCampaignsReportTool.
Resuming starts spending money again: tell the user which campaign and its budget, and get their confirmation first.
`,
      inputSchema: z.object({
        campaignId: z.string(),
        status: z.enum(['active', 'paused']),
      }),
      outputSchema: z.object({ output: adsCampaignOutput }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          context?.requestContext?.get('organization' as never) as string
        ).id;

        try {
          return {
            output: await this._adsService.setCampaignStatus(
              organizationId,
              inputData.campaignId,
              inputData.status
            ),
          };
        } catch (err: unknown) {
          return asToolErrors(err);
        }
      },
    });
  }
}
