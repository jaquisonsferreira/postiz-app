import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { CompositionService } from '@gitroom/nestjs-libraries/database/prisma/compositions/composition.service';
import {
  asToolErrors,
  compositionErrors,
  compositionOutput,
  presentComposition,
} from '@gitroom/nestjs-libraries/chat/tools/composition.tool.output';

@Injectable()
export class CompositionGetTool implements AgentToolInterface {
  constructor(private _compositionService: CompositionService) {}
  name = 'compositionGetTool';
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'compositionGetTool',
      mcp: {
        annotations: {
          title: 'Get Composition',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      description: `
Get one composition by its id: its status (pending, rendering, scheduling, awaiting_approval, scheduled or failed), the reason in "error" when it failed, the slides' text, each channel's caption, the generated media and the created posts with their preview page.
Use it to follow a composition after creating it.
If the composition does not exist, the result contains output.errors.
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
              await this._compositionService.getCompositionWithContent(
                organizationId,
                inputData.id
              )
            ),
          };
        } catch (err: unknown) {
          return asToolErrors(err);
        }
      },
    });
  }
}
