import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { AdsService } from '@gitroom/nestjs-libraries/database/prisma/ads/ads.service';

@Injectable()
export class AdsAccountsListTool implements AgentToolInterface {
  constructor(private _adsService: AdsService) {}
  name = 'adsAccountsListTool';
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'adsAccountsListTool',
      mcp: {
        annotations: {
          title: 'List Ad Accounts',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      description: `
List the connected ad accounts (Meta Ads and Google Ads) with what they spent this month and their budget rule.
Money is in cents of the account currency: 12345 in BRL is R$ 123,45.
monthlyCap pauses every campaign of the account when the month spend reaches it, approvalThreshold sends a boost above it to a person's approval, alertAt is the percentage of the cap that sends an alert.
`,
      inputSchema: z.object({}),
      outputSchema: z.object({
        output: z.object({
          accounts: z.array(
            z.object({
              accountId: z.string(),
              provider: z.string().describe('meta-ads or google-ads'),
              name: z.string(),
              currency: z.string(),
              monthSpend: z.number().describe('Cents spent since the first day of the month'),
              rule: z
                .object({
                  monthlyCap: z.number().nullable(),
                  approvalThreshold: z.number().nullable(),
                  alertAt: z.number().nullable(),
                })
                .nullable(),
            })
          ),
        }),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          context?.requestContext?.get('organization' as never) as string
        ).id;

        return { output: { accounts: await this._adsService.budget(organizationId) } };
      },
    });
  }
}
