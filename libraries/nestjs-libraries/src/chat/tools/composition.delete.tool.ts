import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { CompositionService } from '@gitroom/nestjs-libraries/database/prisma/compositions/composition.service';
import {
  compositionErrors,
} from '@gitroom/nestjs-libraries/chat/tools/composition.tool.output';
import { asToolErrors } from '@gitroom/nestjs-libraries/chat/tools/tool.errors';

@Injectable()
export class CompositionDeleteTool implements AgentToolInterface {
  constructor(private _compositionService: CompositionService) {}
  name = 'compositionDeleteTool';
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'compositionDeleteTool',
      mcp: {
        annotations: {
          title: 'Delete Composition',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      description: `
Delete a composition: stops its rendering if it is still running, deletes its posts on every channel (a scheduled post is not published) and the composition.
Posts already published stay live on the social network.
It can be sent again: a deletion that stopped in the middle finishes removing the posts.
The deletion cannot be undone, so show the user which composition will be deleted and get their confirmation first.
If the composition does not exist, the result contains output.errors.
`,
      inputSchema: z.object({
        id: z.string().describe('The id of the composition'),
      }),
      outputSchema: z.object({
        output: z.object({ id: z.string() }).or(compositionErrors),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          context?.requestContext?.get('organization' as never) as string
        ).id;

        try {
          return {
            output: await this._compositionService.deleteComposition(
              organizationId,
              inputData.id
            ),
          };
        } catch (err: unknown) {
          return asToolErrors(err);
        }
      },
    });
  }
}
