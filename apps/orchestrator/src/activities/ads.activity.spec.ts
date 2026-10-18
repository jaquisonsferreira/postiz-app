import { HttpException } from '@nestjs/common';
import { ApplicationFailure } from '@temporalio/common';
import { AdsActivity } from '@gitroom/orchestrator/activities/ads.activity';
import { AdsService } from '@gitroom/nestjs-libraries/database/prisma/ads/ads.service';
import { AdsBoostService } from '@gitroom/nestjs-libraries/database/prisma/ads/ads.boost.service';

// The integration manager loads ESM-only packages that Jest can't require, each
// test passes the stub of the calls it expects
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class IntegrationManager {},
}));

const activityWith = (ads: Partial<AdsService>, boosts: Partial<AdsBoostService> = {}) =>
  new AdsActivity(ads as AdsService, boosts as AdsBoostService);

describe('AdsActivity', () => {
  it('sincroniza todas as contas de anúncio e devolve quantas falharam', async () => {
    const syncAll = jest.fn(async () => ({ synced: 2, failed: 1 }));
    const activity = activityWith({ syncAll });

    await expect(activity.syncAdAccounts()).resolves.toEqual({ synced: 2, failed: 1 });
    expect(syncAll).toHaveBeenCalledTimes(1);
  });

  it('vigia o teto mensal e impulsiona os posts novos dos canais automáticos', async () => {
    const guardBudgets = jest.fn(async () => ({ capped: 1, alerted: 0 }));
    const autoBoost = jest.fn(async () => ({ created: 2, failed: 0 }));
    const activity = activityWith({ guardBudgets }, { autoBoost });

    await expect(activity.guardAdBudgets()).resolves.toEqual({ capped: 1, alerted: 0 });
    await expect(activity.autoBoostPosts()).resolves.toEqual({ created: 2, failed: 0 });
  });

  it('lança o impulsionamento pelo id', async () => {
    const launch = jest.fn(async () => undefined);
    await activityWith({}, { launch }).launchBoost({ boostId: 'boost-1' });
    expect(launch).toHaveBeenCalledWith('boost-1');
  });

  it('para sem novas tentativas quando a plataforma recusa o anúncio', async () => {
    const launch = jest.fn(async () => {
      throw new HttpException('Meta Ads: the post cannot be promoted', 400);
    });

    const error = await activityWith({}, { launch })
      .launchBoost({ boostId: 'boost-1' })
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ApplicationFailure);
    expect(error).toMatchObject({
      message: 'Meta Ads: the post cannot be promoted',
      type: 'boost_stop',
      nonRetryable: true,
    });
  });

  it('deixa a falha de rede para uma nova tentativa', async () => {
    const launch = jest.fn(async () => {
      throw new Error('socket hang up');
    });

    await expect(activityWith({}, { launch }).launchBoost({ boostId: 'boost-1' })).rejects.toThrow(
      'socket hang up'
    );
  });

  it('marca o impulsionamento como falho com o motivo', async () => {
    const fail = jest.fn(async () => undefined);
    await activityWith({}, { fail }).failBoost({ boostId: 'boost-1', error: 'Sem saldo' });
    expect(fail).toHaveBeenCalledWith('boost-1', 'Sem saldo');
  });
});
