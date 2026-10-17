import {
  ActivityFailure,
  ApplicationFailure,
  CancellationScope,
  proxyActivities,
} from '@temporalio/workflow';
import { CompositionActivity } from '@gitroom/orchestrator/activities/composition.activity';

// Rendering can pay for AI backgrounds, so a failed attempt is tried once more only
const { renderComposition } = proxyActivities<CompositionActivity>({
  startToCloseTimeout: '15 minute',
  taskQueue: 'main',
  retry: {
    maximumAttempts: 2,
    backoffCoefficient: 1,
    initialInterval: '30 seconds',
  },
});

// Scheduling upserts the same post ids on every attempt, so it is safe to retry
const { scheduleComposition, failComposition } = proxyActivities<CompositionActivity>({
  startToCloseTimeout: '2 minute',
  taskQueue: 'main',
  retry: {
    maximumAttempts: 5,
    backoffCoefficient: 2,
    initialInterval: '10 seconds',
    maximumInterval: '2 minutes',
  },
});

// Only a "composition_stop" was written for the caller, anything else (a
// provider's answer, a timeout) is for the logs
const reason = (err: unknown, fallback: string): string => {
  const cause = err instanceof ActivityFailure ? err.cause : err;
  return cause instanceof ApplicationFailure && cause.type === 'composition_stop'
    ? cause.message
    : fallback;
};

export async function compositionWorkflow({ compositionId }: { compositionId: string }) {
  try {
    await renderComposition({ compositionId });
  } catch (err: unknown) {
    return CancellationScope.nonCancellable(() =>
      failComposition({ compositionId, error: reason(err, 'The slides could not be rendered') })
    );
  }

  try {
    await scheduleComposition({ compositionId });
  } catch (err: unknown) {
    return CancellationScope.nonCancellable(() =>
      failComposition({ compositionId, error: reason(err, 'The posts could not be created') })
    );
  }
}
