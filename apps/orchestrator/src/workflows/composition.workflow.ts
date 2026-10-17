import {
  ActivityFailure,
  ApplicationFailure,
  CancellationScope,
  proxyActivities,
} from '@temporalio/workflow';
import { CompositionActivity } from '@gitroom/orchestrator/activities/composition.activity';
import { compositionQueues } from '@gitroom/nestjs-libraries/temporal/composition.queues';

// Rendering starts at the first slide that was not saved and AI backgrounds
// are cached, so a retry never pays twice. The third attempt is there for the
// one that lost a slide to a timed-out attempt still running. The heartbeat
// tells a worker that died mid-render from a slow AI generation. A render that
// waits for a free browser waits on its queue, before the timeout starts
const { renderComposition } = proxyActivities<CompositionActivity>({
  startToCloseTimeout: '15 minute',
  heartbeatTimeout: '1 minute',
  taskQueue: compositionQueues.render.taskQueue,
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 1,
    initialInterval: '30 seconds',
  },
});

// Scheduling saves each post on the composition as soon as it exists, so a
// retry continues where it stopped. The heartbeat stops a worker that is still
// running a timed-out attempt from going unnoticed for the whole timeout
const { scheduleComposition } = proxyActivities<CompositionActivity>({
  startToCloseTimeout: '5 minute',
  heartbeatTimeout: '1 minute',
  taskQueue: 'main',
  retry: {
    maximumAttempts: 5,
    backoffCoefficient: 2,
    initialInterval: '10 seconds',
    maximumInterval: '2 minutes',
  },
});

const { failComposition } = proxyActivities<CompositionActivity>({
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
