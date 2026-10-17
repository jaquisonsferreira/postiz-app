import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { ApplicationFailure } from '@temporalio/common';
import { CompositionService } from '@gitroom/nestjs-libraries/database/prisma/compositions/composition.service';
import { CompositionValidationError } from '@gitroom/nestjs-libraries/compositions/composition.errors';
import { truncateForTemporal } from '@gitroom/nestjs-libraries/integrations/social.abstract';

// A reason retrying can't change (a bad channel, an image that can't be read):
// the workflow stops and the message is what the caller reads on the composition
const stopOnValidation = async <T>(run: () => Promise<T>): Promise<T> => {
  try {
    return await run();
  } catch (err: unknown) {
    if (err instanceof CompositionValidationError) {
      throw ApplicationFailure.nonRetryable(
        truncateForTemporal(err.message, 2000),
        'composition_stop'
      );
    }
    throw err;
  }
};

// An activity on main can never change its parameters, so every one takes a
// single object of ids: the state lives on the composition record
@Injectable()
@Activity()
export class CompositionActivity {
  constructor(private _compositionService: CompositionService) {}

  @ActivityMethod()
  async renderComposition({ compositionId }: { compositionId: string }) {
    await stopOnValidation(() => this._compositionService.renderMedia(compositionId));
  }

  @ActivityMethod()
  async scheduleComposition({ compositionId }: { compositionId: string }) {
    await stopOnValidation(() => this._compositionService.schedule(compositionId));
  }

  @ActivityMethod()
  async failComposition({ compositionId, error }: { compositionId: string; error: string }) {
    await this._compositionService.fail(compositionId, error);
  }
}
