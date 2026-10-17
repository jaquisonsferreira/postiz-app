import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { CompositionService } from '@gitroom/nestjs-libraries/database/prisma/compositions/composition.service';
import {
  compositionOutput,
  presentComposition,
} from '@gitroom/nestjs-libraries/chat/tools/composition.tool.output';

@Injectable()
export class CompositionsListTool implements AgentToolInterface {
  constructor(private _compositionService: CompositionService) {}
  name = 'compositionsListTool';
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'compositionsListTool',
      mcp: {
        annotations: {
          title: 'List Compositions',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      description: `
List the compositions (posts whose images Postiz designed), newest first, 20 per page.
Pass status "awaiting_approval" to list the ones waiting for an approval.
Each item has its id, status, publish date, the slides' text, each channel's caption, the generated media and the created posts with their preview page.
`,
      inputSchema: z.object({
        page: z.number().optional().describe('The page, starting at 0'),
        status: z
          .string()
          .optional()
          .describe(
            'Only the compositions in this status: pending, rendering, scheduling, awaiting_approval, scheduled or failed'
          ),
      }),
      outputSchema: z.object({
        output: z.object({ compositions: z.array(compositionOutput) }),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          context?.requestContext?.get('organization' as never) as string
        ).id;

        const compositions = await this._compositionService.getCompositionsWithContent(
          organizationId,
          inputData.page || 0,
          inputData.status
        );

        return { output: { compositions: compositions.map(presentComposition) } };
      },
    });
  }
}
