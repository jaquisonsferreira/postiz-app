import {
  continueAsNew,
  proxyActivities,
  sleep,
  workflowInfo,
} from '@temporalio/workflow';
import { AdsActivity } from '@gitroom/orchestrator/activities/ads.activity';

// An account that fails is logged and skipped inside the activity, so a retry
// only happens when the whole run could not start
const { syncAdAccounts } = proxyActivities<AdsActivity>({
  startToCloseTimeout: '30 minute',
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 1,
    initialInterval: '2 minutes',
  },
});

export async function adsSyncWorkflow() {
  let loops = 0;
  await syncAdAccounts();
  while (true) {
    await sleep('1 hour');

    // Keep the history small, the new run syncs immediately so the hourly cadence is kept
    if (++loops >= 24 || workflowInfo().historyLength > 1000) {
      return await continueAsNew<typeof adsSyncWorkflow>();
    }

    await syncAdAccounts();
  }
}
