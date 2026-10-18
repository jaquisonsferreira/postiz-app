import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { AdsService } from '@gitroom/nestjs-libraries/database/prisma/ads/ads.service';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

@Injectable()
export class AdsCampaignsReportTool implements AgentToolInterface {
  constructor(private _adsService: AdsService) {}
  name = 'adsCampaignsReportTool';
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'adsCampaignsReportTool',
      mcp: {
        annotations: {
          title: 'Ads Report',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      description: `
Report the ad campaigns of every connected account for a period: the totals per currency, the spend per day and each campaign with its spend, impressions, clicks and conversions.
The numbers come from the hourly sync, so the last hour may be missing. Money is in cents of the account currency, never add values of different currencies.
When judging a campaign, compare the cost per click (spend / clicks) and the click rate (clicks / impressions) between campaigns of the same objective, and wait for at least a few days of data before calling one a loser.
`,
      inputSchema: z.object({
        from: day.describe('First day, YYYY-MM-DD'),
        to: day.describe('Last day, YYYY-MM-DD'),
      }),
      outputSchema: z.object({
        output: z.object({
          totals: z.array(
            z.object({
              currency: z.string(),
              spend: z.number(),
              impressions: z.number(),
              clicks: z.number(),
              conversions: z.number(),
            })
          ),
          daily: z.array(
            z.object({
              date: z.string(),
              currency: z.string(),
              spend: z.number(),
              impressions: z.number(),
              clicks: z.number(),
            })
          ),
          campaigns: z.array(
            z
              .object({
                id: z.string().describe('The campaign id to pause or change its budget'),
                name: z.string(),
                status: z.string().describe('active, paused or removed'),
                provider: z.string(),
                spend: z.number(),
                impressions: z.number(),
                clicks: z.number(),
                conversions: z.number(),
              })
              .passthrough()
          ),
        }),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          context?.requestContext?.get('organization' as never) as string
        ).id;

        return {
          output: await this._adsService.summary(organizationId, {
            from: inputData.from,
            to: inputData.to,
          }),
        };
      },
    });
  }
}
