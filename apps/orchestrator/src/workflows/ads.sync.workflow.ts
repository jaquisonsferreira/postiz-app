import {
  continueAsNew,
  log,
  proxyActivities,
  sleep,
  workflowInfo,
} from '@temporalio/workflow';
import { AdsActivity } from '@gitroom/orchestrator/activities/ads.activity';

// An account that fails is logged and skipped inside the activity, so a retry
// only happens when the whole run could not start
const { syncAdAccounts, guardAdBudgets, autoBoostPosts } = proxyActivities<AdsActivity>({
  startToCloseTimeout: '30 minute',
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 1,
    initialInterval: '2 minutes',
  },
});

const logged = async (name: string, run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (err) {
    log.error(`${name} failed, trying again in the next hour`, { err });
  }
};

// The budget guard reads the spend the sync just saved, and new posts are
// only boosted after a cap had the chance to stop the account
const syncLogged = async () => {
  await logged('Ad accounts sync', syncAdAccounts);
  await logged('Ad budget guard', guardAdBudgets);
  await logged('Automatic boost', autoBoostPosts);
};

export async function adsSyncWorkflow() {
  let loops = 0;
  await syncLogged();
  while (true) {
    await sleep('1 hour');

    // Keep the history small, the new run syncs immediately so the hourly cadence is kept
    if (++loops >= 24 || workflowInfo().historyLength > 1000) {
      return await continueAsNew<typeof adsSyncWorkflow>();
    }

    await syncLogged();
  }
}
