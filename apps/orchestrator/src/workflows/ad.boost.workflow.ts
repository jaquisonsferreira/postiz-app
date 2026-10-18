import {
  ActivityFailure,
  ApplicationFailure,
  CancellationScope,
  proxyActivities,
} from '@temporalio/workflow';
import { AdsActivity } from '@gitroom/orchestrator/activities/ads.activity';

// Every id the platform gives is saved as soon as it exists, so a retry
// continues the same campaign instead of creating a second one
const { launchBoost } = proxyActivities<AdsActivity>({
  startToCloseTimeout: '5 minute',
  taskQueue: 'main',
  retry: {
    maximumAttempts: 5,
    backoffCoefficient: 2,
    initialInterval: '30 seconds',
    maximumInterval: '5 minutes',
  },
});

const { failBoost } = proxyActivities<AdsActivity>({
  startToCloseTimeout: '2 minute',
  taskQueue: 'main',
  retry: {
    maximumAttempts: 5,
    backoffCoefficient: 2,
    initialInterval: '10 seconds',
    maximumInterval: '2 minutes',
  },
});

const reason = (err: unknown): string => {
  const cause = err instanceof ActivityFailure ? err.cause : err;
  return cause instanceof ApplicationFailure && cause.type === 'boost_stop'
    ? cause.message
    : 'The ad could not be created on the platform';
};

export async function adBoostWorkflow({ boostId }: { boostId: string }) {
  try {
    await launchBoost({ boostId });
  } catch (err: unknown) {
    return CancellationScope.nonCancellable(() => failBoost({ boostId, error: reason(err) }));
  }
}
