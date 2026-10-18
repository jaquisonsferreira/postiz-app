import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { CompositionService } from '@gitroom/nestjs-libraries/database/prisma/compositions/composition.service';
import {
  compositionErrors,
  compositionOutput,
  presentComposition,
} from '@gitroom/nestjs-libraries/chat/tools/composition.tool.output';
import { asToolErrors } from '@gitroom/nestjs-libraries/chat/tools/tool.errors';

@Injectable()
export class CompositionApproveTool implements AgentToolInterface {
  constructor(private _compositionService: CompositionService) {}
  name = 'compositionApproveTool';
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'compositionApproveTool',
      mcp: {
        annotations: {
          title: 'Approve Composition',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      description: `
Approve a composition in status "awaiting_approval": its draft posts are queued to be published at the composition date, and the result is the composition with status "scheduled".
Each draft is checked again before it is queued, including the ones edited in the Postiz dashboard.
Show the user the composition (slides, captions, channels and date) and get their confirmation first.
If it cannot be approved (another status, a draft that fails the channel checks, the plan's monthly posts limit), the result contains output.errors explaining why.
`,
      inputSchema: z.object({
        id: z.string().describe('The id of the composition'),
      }),
      outputSchema: z.object({
        output: compositionOutput.or(compositionErrors),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          context?.requestContext?.get('organization' as never) as string
        ).id;

        try {
          return {
            output: presentComposition(
              await this._compositionService.approveComposition(organizationId, inputData.id)
            ),
          };
        } catch (err: unknown) {
          return asToolErrors(err);
        }
      },
    });
  }
}
